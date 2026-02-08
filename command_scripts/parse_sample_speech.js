const fs = require('fs');
const path = require('path');

// 嘗試載入 cheerio，如果沒有安裝則使用備用方案
const cheerio = require('cheerio');

// 輸入和輸出路徑
const inputHtmlPath = path.join(__dirname, '..', 'raw_sample_data', '2025-11-10-柏林自由會議ai-的角色.html');
const outputJsonPath = path.join(__dirname, '..', 'data', 'speech', '2025-11-10-柏林自由會議ai-的角色.json');
const outputSqlPath = path.join(__dirname, '..', 'sql', 'speech', '2025-11-10-柏林自由會議ai-的角色.sql');

// 從檔名提取 filename（去掉 .html）
const htmlFilename = path.basename(inputHtmlPath);
const filename = htmlFilename.replace(/\.html$/, '');

console.log('讀取 HTML 文件:', inputHtmlPath);
console.log('提取的檔名:', filename);

// 讀取 HTML 文件
const htmlContent = fs.readFileSync(inputHtmlPath, 'utf8');
const $ = cheerio.load(htmlContent);

// 找到 <ul class="section-list"> 元素
const $sectionList = $('ul.section-list');
if ($sectionList.length === 0) {
  console.error('錯誤: 找不到 <ul class="section-list"> 元素');
  process.exit(1);
}

// 提取所有 <li> 元素
const $listItems = $sectionList.find('> li');
console.log(`找到 ${$listItems.length} 個 <li> 元素`);

// 解析每個 <li> 元素
const speechData = [];

$listItems.each((index, liElement) => {
  const $li = $(liElement);

  // 提取 section_id: 從 <li> 的 id 屬性去掉前面的 "s"
  const liId = $li.attr('id') || '';
  const sectionId = liId.replace(/^s/, '');

  if (!sectionId) {
    console.warn(`警告: <li> 元素 #${index} 沒有有效的 id`);
  }

  // 提取 section_speaker: 從 <span class="speech__meta-data__speaker-name"> 下的 <a href> 提取
  let sectionSpeaker = null;
  const $speakerLink = $li.find('span.speech__meta-data__speaker-name a');
  if ($speakerLink.length > 0) {
    const href = $speakerLink.attr('href') || '';
    // 移除 "/speaker/" 前綴
    sectionSpeaker = href.replace(/^\/speaker\//, '');
    if (sectionSpeaker === href) {
      // 如果沒有匹配到，設為 null
      sectionSpeaker = null;
    }
  }

  // 提取 section_content: <div class="speech__content"> 的完整 innerHTML
  let sectionContent = '';
  const $contentDiv = $li.find('div.speech__content');
  if ($contentDiv.length > 0) {
    // 使用 html() 獲取完整的 innerHTML
    sectionContent = $contentDiv.html() || '';

    // 優化：去掉開頭到第一個 tag 之間的空白和換行，以及最後一個 tag 之後的空白和換行
    if (sectionContent) {
      // 使用正則表達式：去掉開頭到第一個 tag 之間的空白和換行
      // 匹配開頭的一個或多個空白字符（包括換行、空格、tab等），但必須緊接著 '<'
      sectionContent = sectionContent.replace(/^\s+(?=<)/, '');

      // 使用正則表達式：去掉最後一個 tag 之後的空白和換行
      // 匹配結尾的一個或多個空白字符（包括換行、空格、tab等），但必須緊接著 '>'
      sectionContent = sectionContent.replace(/(?<=>)\s+$/, '');

      // 處理 tag 中間：將「換行符接著超過一個空白鍵」的模式替換為空字串
      // 匹配換行符後面跟著兩個或更多空白字符（包括空格、tab等）
      sectionContent = sectionContent.replace(/\n\s{2,}/g, '');
    }
  }

  // 建立物件
  const speechItem = {
    filename: filename,
    nest_filename: null,
    nest_display_name: null,
    section_id: sectionId ? parseInt(sectionId, 10) : null,
    section_speaker: sectionSpeaker,
    section_content: sectionContent
  };

  speechData.push(speechItem);
});

// 加入 previous_section_id 和 next_section_id
speechData.forEach((item, index) => {
  item.previous_section_id = index > 0 ? speechData[index - 1].section_id : null;
  item.next_section_id = index < speechData.length - 1 ? speechData[index + 1].section_id : null;
});

// 收集所有唯一的 (speech_filename, speaker_route_pathname) 組合
const speechSpeakersSet = new Set();
speechData.forEach((item) => {
  if (item.section_speaker) {
    // 使用 "filename||||speaker" 作為唯一鍵（使用四個連續的 '|' 作為分隔符，避免檔名或講者名稱中的 '|' 造成問題）
    const key = `${item.filename}||||${item.section_speaker}`;
    speechSpeakersSet.add(key);
  }
});

console.log(`成功解析 ${speechData.length} 筆資料`);
console.log(`找到 ${speechSpeakersSet.size} 個唯一的演講-講者關係`);

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
const jsonContent = JSON.stringify(speechData, null, 2);
fs.writeFileSync(outputJsonPath, jsonContent, 'utf8');
console.log(`成功生成 JSON 文件: ${outputJsonPath}`);

// 生成 SQL 文件
let sqlStatements = [];
sqlStatements.push('-- 自動生成的 SQL 插入語句');
sqlStatements.push(`-- 來源: raw_sample_data/${htmlFilename}`);
sqlStatements.push('-- 生成時間: ' + new Date().toISOString());
sqlStatements.push('');
sqlStatements.push('-- 使用 INSERT OR IGNORE 避免插入重複的 section_id（需要 PRIMARY KEY 約束）');
sqlStatements.push('');

// 為每筆資料生成 INSERT 語句
speechData.forEach((item) => {
  // 轉義單引號（SQL 字符串中的單引號需要轉義為兩個單引號）
  const escapedFilename = (item.filename || '').replace(/'/g, "''");
  const escapedSpeaker = (item.section_speaker || '').replace(/'/g, "''");
  const escapedContent = (item.section_content || '').replace(/'/g, "''");

  const sectionId = item.section_id !== null ? item.section_id : 'NULL';
  const previousSectionId = item.previous_section_id !== null ? item.previous_section_id : 'NULL';
  const nextSectionId = item.next_section_id !== null ? item.next_section_id : 'NULL';
  const speakerValue = item.section_speaker ? `'${escapedSpeaker}'` : 'NULL';
  const contentValue = item.section_content ? `'${escapedContent}'` : 'NULL';

  sqlStatements.push(
    `INSERT OR IGNORE INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES ('${escapedFilename}', NULL, NULL, ${sectionId}, ${previousSectionId}, ${nextSectionId}, ${speakerValue}, ${contentValue});`
  );
});

sqlStatements.push('');
sqlStatements.push('-- 插入演講-講者關係到 speech_speakers 表');
sqlStatements.push('-- 使用 INSERT OR IGNORE 避免插入重複的 (speech_filename, speaker_route_pathname) 組合');
sqlStatements.push('');

// 為每個唯一的演講-講者關係生成 INSERT 語句
speechSpeakersSet.forEach((key) => {
  const [speechFilename, speakerRoutePathname] = key.split('||||');
  const escapedFilename = (speechFilename || '').replace(/'/g, "''");
  const escapedSpeaker = (speakerRoutePathname || '').replace(/'/g, "''");

  sqlStatements.push(
    `INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES ('${escapedFilename}', '${escapedSpeaker}');`
  );
});

sqlStatements.push('');

// 寫入 SQL 文件
const sqlContent = sqlStatements.join('\n');
fs.writeFileSync(outputSqlPath, sqlContent, 'utf8');
console.log(`成功生成 SQL 文件: ${outputSqlPath}`);
console.log(`共處理 ${speechData.length} 筆資料`);

