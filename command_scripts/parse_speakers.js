const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// 輸入和輸出路徑
const inputHtmlPath = path.join(__dirname, '..', 'raw_sample_data', 'speakers.html');
const outputJsonPath = path.join(__dirname, '..', 'data', 'speakers.json');
const outputSqlPath = path.join(__dirname, '..', 'sql', 'fill-speakers.sql');

console.log('讀取 HTML 文件:', inputHtmlPath);

// 讀取 HTML 文件
const htmlContent = fs.readFileSync(inputHtmlPath, 'utf8');
const $ = cheerio.load(htmlContent);

// 找到 <ul class="speaker-list"> 元素
const $speakerList = $('ul.speaker-list');
if ($speakerList.length === 0) {
  console.error('錯誤: 找不到 <ul class="speaker-list"> 元素');
  process.exit(1);
}

// 提取所有 <li> 元素
const $listItems = $speakerList.find('> li');
console.log(`找到 ${$listItems.length} 個 <li> 元素`);

// 解析每個 <li> 元素
const speakersData = [];

$listItems.each((index, liElement) => {
  const $li = $(liElement);

  // 找到 <a> 標籤
  const $link = $li.find('a');
  if ($link.length === 0) {
    console.warn(`警告: <li> 元素 #${index} 沒有找到 <a> 標籤`);
    return;
  }

  // 提取 route_pathname: 從 <a> 的 href 屬性去掉開頭的 '/speaker/'
  let href = $link.attr('href') || '';
  let routePathname = '';
  if (href.startsWith('/speaker/')) {
    routePathname = href.substring('/speaker/'.length);
  } else {
    console.warn(`警告: <li> 元素 #${index} 的 href 格式不符合預期: ${href}`);
    return;
  }

  // 找到 <img> 標籤
  const $img = $li.find('img');
  let photoURL = null;
  if ($img.length > 0) {
    const src = $img.attr('src') || '';
    // 特例: 如果 src 是 "/static/speeches/i/a.png"，photoURL 就是 NULL
    if (src !== '/static/speeches/i/a.png') {
      photoURL = src;
    }
  }

  // 提取 name: <span class="speaker-card__name"> 標籤包住的文字內容（保留空白）
  const $nameSpan = $li.find('span.speaker-card__name');
  const name = $nameSpan.length > 0 ? $nameSpan.text() : '';

  if (!routePathname || !name) {
    console.warn(`警告: <li> 元素 #${index} 的 route_pathname 或 name 為空`);
    return;
  }

  // 建立物件
  const speakerItem = {
    route_pathname: routePathname,
    name: name,
    photoURL: photoURL
  };

  speakersData.push(speakerItem);
});

console.log(`成功解析 ${speakersData.length} 筆資料`);

// 確保輸出目錄存在
const jsonDir = path.dirname(outputJsonPath);
const sqlDir = path.dirname(outputSqlPath);
if (!fs.existsSync(jsonDir)) {
  fs.mkdirSync(jsonDir, { recursive: true });
}
if (!fs.existsSync(sqlDir)) {
  fs.mkdirSync(sqlDir, { recursive: true });
}

// 生成 JSON 文件
const jsonContent = JSON.stringify(speakersData, null, 2);
fs.writeFileSync(outputJsonPath, jsonContent, 'utf8');
console.log(`成功生成 JSON 文件: ${outputJsonPath}`);

// 生成 SQL 文件
let sqlStatements = [];
sqlStatements.push('-- 自動生成的 SQL 插入語句');
sqlStatements.push('-- 來源: raw_sample_data/speakers.html');
sqlStatements.push('-- 生成時間: ' + new Date().toISOString());
sqlStatements.push('');
sqlStatements.push('-- 使用 INSERT OR IGNORE 避免插入重複的 route_pathname（需要 UNIQUE 約束）');
sqlStatements.push('');

// 為每筆資料生成 INSERT 語句
speakersData.forEach((item) => {
  // 轉義單引號（SQL 字符串中的單引號需要轉義為兩個單引號）
  const escapedRoutePathname = (item.route_pathname || '').replace(/'/g, "''");
  const escapedName = (item.name || '').replace(/'/g, "''");

  // 處理 photoURL：如果是 null，SQL 中寫 NULL，否則轉義單引號
  let photoURLValue;
  if (item.photoURL === null) {
    photoURLValue = 'NULL';
  } else {
    const escapedPhotoURL = (item.photoURL || '').replace(/'/g, "''");
    photoURLValue = `'${escapedPhotoURL}'`;
  }

  // 使用 INSERT OR IGNORE 來避免插入重複的 route_pathname
  sqlStatements.push(
    `INSERT OR IGNORE INTO speakers (route_pathname, name, photoURL) VALUES ('${escapedRoutePathname}', '${escapedName}', ${photoURLValue});`
  );
});

sqlStatements.push('');

// 寫入 SQL 文件
const sqlContent = sqlStatements.join('\n');
fs.writeFileSync(outputSqlPath, sqlContent, 'utf8');
console.log(`成功生成 SQL 文件: ${outputSqlPath}`);
console.log(`共處理 ${speakersData.length} 筆資料`);
