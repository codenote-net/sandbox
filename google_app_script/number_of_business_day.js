const TARGET = {
  DATES: [10, 15], // 日付指定
  NUMBER_OF_BUSINESS_DAYS: [6, 8], // 第 n 営業日
  HOURS: 9, // トリガー実行時間(時)
  MINUTES: 00, // トリガー実行時間(分)
};

// トリガーを設定可能か判定する
//
// @return {boolean}
function canSetTrigger() {
  const today = new Date();
  const todayDate = today.getDate();
  if (TARGET.DATES.includes(todayDate)) {
    return true;
  }

  const todayNumberOfBusinessDay = numberOfBusinessDay(today);
  if (TARGET.NUMBER_OF_BUSINESS_DAYS.includes(todayNumberOfBusinessDay)) {
    return true;
  }

  return false;
}

// トリガーを設定する
function setTrigger() {
  if (canSetTrigger()) {
    const date = new Date();
    date.setHours(TARGET.HOURS);
    date.setMinutes(TARGET.MINUTES);

    ScriptApp.newTrigger("myFunction").timeBased().at(date).create();
  }
}

// トリガーを削除する
function delTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === "myFunction") {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

// 営業日を判定する
//
// @return {boolean}
// * 土日 false
// * 祝日 false
// * それ以外 true
function isBusinessDay(date) {
  if (date.getDay() == 0 || date.getDay() == 6) {
    return false;
  }

  const calJa = CalendarApp.getCalendarById(
    "ja.japanese#holiday@group.v.calendar.google.com"
  );
  if (calJa.getEventsForDay(date).length > 0) {
    return false;
  }

  return true;
}

// 第 n 営業日の何日目か算出する
//
// @return {number} num
// * 営業日では無い場合は 0 を返す
// * 第 n 営業日の場合は n を返す
function numberOfBusinessDay() {
  const now = new Date();
  let num = 0;
  let countDayOfMonth;

  if (!isBusinessDay(now)) {
    return num;
  }

  for (let i = 1; i <= now.getDate(); i++) {
    countDayOfMonth = new Date(now.getFullYear(), now.getMonth(), i); //　次の日をセット
    if (isBusinessDay(countDayOfMonth)) {
      num = num + 1; // 営業日をカウントアップ
    }
  }
  return num;
}

function postSlackMessage(text) {
  const data = {
    text: text,
  };
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(data), // Convert the JavaScript object to a JSON string.
  };

  UrlFetchApp.fetch(
    PropertiesService.getScriptProperties().getProperties().SLACK_URL,
    options
  );
}

function myFunction() {
  delTrigger();
  postSlackMessage("オハヨウゴザイマス！");
}
