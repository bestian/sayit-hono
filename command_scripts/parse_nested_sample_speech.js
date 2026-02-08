const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// 固定處理 1999 年全國司法改革會議的巢狀資料
const baseFilename = '1999年全國司法改革會議'; // 主檔名（與巢狀目錄同名）
const outputBaseName = '1999年全國司法改革會議'; // 輸出檔名(與巢狀目錄同名)

const rootDir = path.join(__dirname, '..');
const motherHtmlPath = path.join(rootDir, 'raw_sample_data', `${baseFilename}.html`);
const nestedFolderPath = path.join(rootDir, 'raw_sample_data', baseFilename);
const outputJsonPath = path.join(rootDir, 'data', 'speech', `${outputBaseName}.json`);
const outputSqlPath = path.join(rootDir, 'sql', 'speech', `${outputBaseName}.sql`);

const escapeSql = (value) => (value || '').replace(/'/g, "''");

console.log('讀取巢狀母檔:', motherHtmlPath);
if (!fs.existsSync(motherHtmlPath)) {
  console.error('錯誤: 找不到巢狀母檔');
  process.exit(1);
}

const motherContent = fs.readFileSync(motherHtmlPath, 'utf8');
const $mother = cheerio.load(motherContent);

// 從母檔抓出所有巢狀子檔資訊
const nestedEntries = [];
$mother('span.section-title a').each((_, anchor) => {
  const $a = $mother(anchor);
  const href = $a.attr('href') || '';
  const parts = href.split('/');
  const tail = parts[parts.length - 1] || '';
  const nestFilename = decodeURIComponent(tail);
  const nestDisplayName = $a.text().trim();

  if (!nestFilename) {
    console.warn('警告: 找到空的 nestFilename，跳過');
    return;
  }

  nestedEntries.push({ nestFilename, nestDisplayName });
});

console.log(`找到 ${nestedEntries.length} 個巢狀子檔`);

if (nestedEntries.length === 0) {
  console.error('錯誤: 母檔中沒有巢狀連結可供處理');
  process.exit(1);
}

// 確保輸出目錄存在
const jsonDir = path.dirname(outputJsonPath);
const sqlDir = path.dirname(outputSqlPath);
if (!fs.existsSync(jsonDir)) {
  fs.mkdirSync(jsonDir, { recursive: true });
}
if (!fs.existsSync(sqlDir)) {
  fs.mkdirSync(sqlDir, { recursive: true });
}

const allSpeechData = [];
const speechSpeakersSet = new Set();

// 處理每一個巢狀子檔
nestedEntries.forEach((entry, idx) => {
  const nestedHtmlPath = path.join(nestedFolderPath, `${entry.nestFilename}.html`);
  console.log(`[${idx + 1}/${nestedEntries.length}] 處理巢狀檔案: ${nestedHtmlPath}`);

  if (!fs.existsSync(nestedHtmlPath)) {
    console.warn(`  警告: 找不到巢檔，跳過: ${nestedHtmlPath}`);
    return;
  }

  const nestedHtml = fs.readFileSync(nestedHtmlPath, 'utf8');
  const $ = cheerio.load(nestedHtml);

  const $listItems = $('ul.section-list > li');
  console.log(`  找到 ${$listItems.length} 個段落`);

  const sectionItems = [];

  $listItems.each((liIndex, liElement) => {
    const $li = $(liElement);

    // section_id: 先從 a[title="Link"] 取得 /speech/<id>，若無則退回 li id
    let sectionId = null;
    const $link = $li.find('a[title="Link"][href^="/speech/"]').first();
    if ($link.length > 0) {
      const href = $link.attr('href') || '';
      const match = href.match(/\/speech\/(\d+)/);
      if (match) {
        sectionId = parseInt(match[1], 10);
      }
    }
    if (sectionId === null) {
      const liId = $li.attr('id') || '';
      const liMatch = liId.match(/^s(\d+)/);
      if (liMatch) {
        sectionId = parseInt(liMatch[1], 10);
      }
    }

    // section_speaker: <span class="speech__meta-data__speaker-name"> 中的 /speaker/<route>
    let sectionSpeaker = null;
    const $speakerLink = $li.find('span.speech__meta-data__speaker-name a[href]').first();
    if ($speakerLink.length > 0) {
      const speakerHref = $speakerLink.attr('href') || '';
      if (speakerHref.startsWith('/speaker/')) {
        sectionSpeaker = speakerHref.replace('/speaker/', '');
      }
    }

    // section_content: div.speech__content 的 innerHTML，做基本修剪
    let sectionContent = '';
    const $contentDiv = $li.find('div.speech__content').first();
    if ($contentDiv.length > 0) {
      sectionContent = $contentDiv.html() || '';
      sectionContent = sectionContent.replace(/^\s+(?=<)/, '');
      sectionContent = sectionContent.replace(/(?<=>)\s+$/, '');
      sectionContent = sectionContent.replace(/\n\s{2,}/g, '');
    }

    const speechItem = {
      filename: baseFilename,
      nest_filename: entry.nestFilename,
      nest_display_name: entry.nestDisplayName,
      section_id: sectionId,
      previous_section_id: null,
      next_section_id: null,
      section_speaker: sectionSpeaker,
      section_content: sectionContent
    };

    sectionItems.push(speechItem);
  });

  // 設定前後段落 ID（僅在同一巢檔內）
  sectionItems.forEach((item, index) => {
    item.previous_section_id = index > 0 ? sectionItems[index - 1].section_id : null;
    item.next_section_id = index < sectionItems.length - 1 ? sectionItems[index + 1].section_id : null;
  });

  // 收集講者關係與所有段落
  sectionItems.forEach((item) => {
    if (item.section_speaker) {
      const key = `${baseFilename}||||${item.section_speaker}`;
      speechSpeakersSet.add(key);
    }
    allSpeechData.push(item);
  });
});

console.log(`共彙整 ${allSpeechData.length} 筆段落`);
console.log(`共找到 ${speechSpeakersSet.size} 個唯一講者關係`);

// 輸出 JSON
const jsonContent = JSON.stringify(allSpeechData, null, 2);
fs.writeFileSync(outputJsonPath, jsonContent, 'utf8');
console.log(`寫入 JSON: ${outputJsonPath}`);

// 生成 SQL
let sqlStatements = [];
sqlStatements.push('-- 自動生成的 SQL 插入語句（巢狀資料）');
sqlStatements.push(`-- 母檔: ${motherHtmlPath}`);
sqlStatements.push(`-- 生成時間: ${new Date().toISOString()}`);
sqlStatements.push('');
sqlStatements.push('-- 使用 INSERT OR IGNORE 避免重複');
sqlStatements.push('');

allSpeechData.forEach((item) => {
  const escapedFilename = escapeSql(item.filename);
  const escapedNestFilename = escapeSql(item.nest_filename);
  const escapedNestDisplayName = escapeSql(item.nest_display_name);
  const escapedSpeaker = escapeSql(item.section_speaker);
  const escapedContent = escapeSql(item.section_content);

  const sectionIdVal = item.section_id !== null ? item.section_id : 'NULL';
  const prevIdVal = item.previous_section_id !== null ? item.previous_section_id : 'NULL';
  const nextIdVal = item.next_section_id !== null ? item.next_section_id : 'NULL';
  const speakerVal = item.section_speaker ? `'${escapedSpeaker}'` : 'NULL';
  const contentVal = item.section_content ? `'${escapedContent}'` : 'NULL';

  const sqlLine = `INSERT OR IGNORE INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES ('${escapedFilename}', '${escapedNestFilename}', '${escapedNestDisplayName}', ${sectionIdVal}, ${prevIdVal}, ${nextIdVal}, ${speakerVal}, ${contentVal});`;
  sqlStatements.push(sqlLine);
});

sqlStatements.push('');
sqlStatements.push('-- 演講-講者關係');
sqlStatements.push('-- 使用 INSERT OR IGNORE 避免重複的 (speech_filename, speaker_route_pathname)');
sqlStatements.push('');

speechSpeakersSet.forEach((key) => {
  const [speechFilename, speakerRoute] = key.split('||||');
  const escapedFilename = escapeSql(speechFilename);
  const escapedSpeaker = escapeSql(speakerRoute);
  const sqlLine = `INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES ('${escapedFilename}', '${escapedSpeaker}');`;
  sqlStatements.push(sqlLine);
});

sqlStatements.push('');

const sqlContent = sqlStatements.join('\n');
fs.writeFileSync(outputSqlPath, sqlContent, 'utf8');
console.log(`寫入 SQL: ${outputSqlPath}`);
console.log('處理完成');

