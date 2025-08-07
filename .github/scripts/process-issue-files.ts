#!/usr/bin/env node
import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

const MAX_FILENAME_LENGTH = 200;
// GitHub's file size constraints:
// - Files uploaded to issues/PRs have a 25MB limit per file, 100MB total per comment
// - Repository files via web interface have a 100MB warning threshold
// We use 25MB to match the per-file limit for issue attachments
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB limit per file

interface FileMetadata {
  issue_number: string;
  comment_id: string;
  files: string[];
  timestamp: string;
}

function extractFileUrls(commentBody: string): string[] {
  const urlSet = new Set<string>();
  
  // GitHub uploaded file URL patterns
  // Pattern 1: /assets/ URLs (older format)
  const assetPattern = /https:\/\/github\.com\/[^\/]+\/[^\/]+\/assets\/\d+\/[\w\-\.%]+/g;
  const assetMatches = commentBody.match(assetPattern) || [];
  assetMatches.forEach(url => urlSet.add(url));
  
  // Pattern 2: /user-attachments/files/ URLs (newer format)
  const attachmentPattern = /https:\/\/github\.com\/user-attachments\/files\/\d+\/[\w\-\.%]+/g;
  const attachmentMatches = commentBody.match(attachmentPattern) || [];
  attachmentMatches.forEach(url => urlSet.add(url));
  
  // Pattern 3: Markdown link formats for different file URL types
  // Split into separate patterns for better maintainability
  
  // 3a. Markdown link to /assets/
  const markdownAssetLinkPattern = /\[[^\]]*\]\((https:\/\/github\.com\/[^\/]+\/[^\/]+\/assets\/\d+\/[\w\-\.%]+)\)/g;
  let assetLinkMatch;
  while ((assetLinkMatch = markdownAssetLinkPattern.exec(commentBody)) !== null) {
    urlSet.add(assetLinkMatch[1]);
  }
  
  // 3b. Markdown link to /user-attachments/files/
  const markdownAttachmentLinkPattern = /\[[^\]]*\]\((https:\/\/github\.com\/user-attachments\/files\/\d+\/[\w\-\.%]+)\)/g;
  let attachmentLinkMatch;
  while ((attachmentLinkMatch = markdownAttachmentLinkPattern.exec(commentBody)) !== null) {
    urlSet.add(attachmentLinkMatch[1]);
  }
  
  // 3c. Markdown link to raw.githubusercontent.com
  const markdownRawLinkPattern = /\[[^\]]*\]\((https:\/\/raw\.githubusercontent\.com\/[^\)]+)\)/g;
  let rawLinkMatch;
  while ((rawLinkMatch = markdownRawLinkPattern.exec(commentBody)) !== null) {
    urlSet.add(rawLinkMatch[1]);
  }
  
  // Pattern 4: Markdown image format
  const imgPattern = /!\[[^\]]*\]\((https:\/\/[^\)]+)\)/g;
  let imgMatch;
  while ((imgMatch = imgPattern.exec(commentBody)) !== null) {
    const url = imgMatch[1];
    if (url.includes('user-images.githubusercontent.com') || url.includes('github.com')) {
      urlSet.add(url);
    }
  }
  
  return Array.from(urlSet);
}

// Only allow downloading from official GitHub domains
function isAllowedGithubDomain(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    // Allow github.com and any subdomain of githubusercontent.com
    return parsed.hostname === 'github.com' ||
           parsed.hostname === 'githubusercontent.com' ||
           parsed.hostname.endsWith('.githubusercontent.com');
  } catch {
    return false;
  }
}

async function downloadFile(url: string, token: string): Promise<Buffer | null> {
  if (!isAllowedGithubDomain(url)) {
    console.error(`Refusing to download from untrusted domain: ${url}`);
    return null;
  }
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/octet-stream'
      },
      redirect: 'follow'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // Check content-length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > MAX_FILE_SIZE) {
        console.error(`File too large: ${size} bytes exceeds limit of ${MAX_FILE_SIZE} bytes`);
        return null;
      }
    }
    
    const arrayBuffer = await response.arrayBuffer();
    
    // Double-check actual size after download
    if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
      console.error(`Downloaded file too large: ${arrayBuffer.byteLength} bytes exceeds limit of ${MAX_FILE_SIZE} bytes`);
      return null;
    }
    
    const buffer = Buffer.from(arrayBuffer);
    return buffer;
  } catch (error) {
    console.error(`Error downloading ${url}:`, error);
    return null;
  }
}

function sanitizeFilename(filename: string): string {
  // Reserved filenames on Windows
  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 
    'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 
    'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  
  // Replace invalid characters
  filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  
  // Trim dots and spaces from start and end
  filename = filename.replace(/^[\s.]+|[\s.]+$/g, '');
  
  // Check for reserved names
  const nameWithoutExt = filename.split('.')[0].toUpperCase();
  if (reservedNames.includes(nameWithoutExt)) {
    filename = `_${filename}`;
  }
  
  // Limit filename length (255 is common limit, use 200 to be safe)
  if (filename.length > MAX_FILENAME_LENGTH) {
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    filename = nameWithoutExt.substring(0, MAX_FILENAME_LENGTH - ext.length) + ext;
  }
  
  // Ensure filename is not empty
  if (!filename) {
    filename = 'file';
  }
  
  return filename;
}

function getFilenameFromUrl(url: string): string {
  // Get the last part of the URL
  let filename = url.split('/').pop() || 'file';
  
  // Add .bin extension if no extension exists
  if (!filename.includes('.')) {
    filename = `${filename}.bin`;
  }
  
  // Sanitize filename for cross-platform compatibility
  filename = sanitizeFilename(filename);
  
  return filename;
}

async function ensureUniqueFilename(dir: string, filename: string): Promise<string> {
  let filePath = path.join(dir, filename);
  let counter = 1;
  
  while (existsSync(filePath)) {
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    const newFilename = `${nameWithoutExt}_${counter}${ext}`;
    filePath = path.join(dir, newFilename);
    counter++;
  }
  
  return filePath;
}

async function setOutput(name: string, value: string): Promise<void> {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error('GITHUB_OUTPUT environment variable is not set.');
  }
  await fs.appendFile(outputPath, `${name}=${value}\n`);
}

async function main(): Promise<void> {
  // Get information from environment variables
  const token = process.env.GITHUB_TOKEN;
  const issueNumber = process.env.ISSUE_NUMBER;
  const commentBody = process.env.COMMENT_BODY || '';
  const commentId = process.env.COMMENT_ID;
  const repository = process.env.GITHUB_REPOSITORY;
  
  if (!token || !issueNumber || !commentId || !repository) {
    console.error('Required environment variables are missing');
    process.exit(1);
  }
  
  // Initialize Octokit client
  const octokit = new Octokit({
    auth: token
  });
  
  // Get repository information
  const [owner, repo] = repository.split('/');
  
  // Validate issue number contains only digits
  if (!/^\d+$/.test(issueNumber)) {
    console.error(`Invalid issue number format: ${issueNumber}`);
    process.exit(1);
  }
  
  // Directory to save files with path traversal protection
  const baseDir = path.resolve('uploaded_files');
  const targetDir = path.join(baseDir, `issue_${issueNumber}`);
  
  // Ensure targetDir is within baseDir to prevent path traversal
  const resolvedTargetDir = path.resolve(targetDir);
  const relative = path.relative(baseDir, resolvedTargetDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    console.error('Path traversal detected in target directory');
    process.exit(1);
  }
  
  // Create directory
  await fs.mkdir(targetDir, { recursive: true });
  
  // Extract file URLs from comment
  const fileUrls = extractFileUrls(commentBody);
  
  if (fileUrls.length === 0) {
    console.log('No file URLs found in the comment');
    await setOutput('files_processed', 'false');
    return;
  }
  
  console.log(`Found ${fileUrls.length} file(s) to download`);
  
  const downloadedFiles: string[] = [];
  
  for (const url of fileUrls) {
    console.log(`Processing: ${url}`);
    
    // Download file
    const content = await downloadFile(url, token);
    if (!content) {
      continue;
    }
    
    // Determine filename
    const filename = getFilenameFromUrl(url);
    
    // Get unique file path
    const filePath = await ensureUniqueFilename(targetDir, filename);
    
    // Save file
    await fs.writeFile(filePath, content);
    downloadedFiles.push(filePath);
    console.log(`Saved: ${filePath}`);
  }
  
  if (downloadedFiles.length > 0) {
    // Set GitHub Actions output
    await setOutput('files_processed', 'true');
    
    const fileList = downloadedFiles.map(f => `- \`${f}\``).join('\n');
    await setOutput('file_list', fileList);
    
    // Create metadata file
    const metadata: FileMetadata = {
      issue_number: issueNumber,
      comment_id: commentId,
      files: downloadedFiles,
      timestamp: new Date().toISOString()
    };
    
    const metadataPath = path.join(targetDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`Successfully processed ${downloadedFiles.length} file(s)`);
  } else {
    await setOutput('files_processed', 'false');
    console.log('No files were successfully downloaded');
  }
}

// Execute main process
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});