/**
 * 剖析所有演講 HTML 文件腳本
 *
 * 功能：
 * - 讀取 data/speech_index.json 中的所有演講項目
 * - 對每個演講項目，剖析對應的 HTML 文件
 * - 生成個別的 JSON 和 SQL 文件
 * - 生成合併的 SQL 文件 (sql/fill-all-speech_content.sql)
 *
 * 執行命令：
 *   node scripts/parse_all_speeches.js ~/sayit-archive-static/sayit.archive.tw
 *
 * 說明：
 *   - target_folder: 所有 .html 檔所在的檔案目錄
 *   - 腳本會根據 speech_index.json 中的 filename，尋找 target_folder/{filename}.html
 *   - 生成的 JSON 檔案會放在 data/speech/ 目錄下
 *   - 生成的 SQL 檔案會放在 sql/speech/ 目錄下
 *   - 最後會生成 sql/fill-all-speech_content.sql 合併所有 SQL 語句
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// 從命令行參數獲取 target_folder
const targetFolder = process.argv[2];
if (!targetFolder) {
  console.error('錯誤: 請提供目標資料夾路徑作為參數');
  console.error('用法: node parse_all_speeches.js <target_folder>');
  process.exit(1);
}

// 讀取 speech_index.json
const speechIndexPath = path.join(__dirname, '..', 'data', 'speech_index.json');
console.log('讀取 speech_index.json:', speechIndexPath);

if (!fs.existsSync(speechIndexPath)) {
  console.error('錯誤: 找不到 speech_index.json 文件');
  process.exit(1);
}

const speechIndex = JSON.parse(fs.readFileSync(speechIndexPath, 'utf8'));
console.log(`找到 ${speechIndex.length} 個演講項目`);

// 確保輸出目錄存在
const jsonOutputDir = path.join(__dirname, '..', 'data', 'speech');
const sqlOutputDir = path.join(__dirname, '..', 'sql', 'speech');
if (!fs.existsSync(jsonOutputDir)) {
  fs.mkdirSync(jsonOutputDir, { recursive: true });
}
if (!fs.existsSync(sqlOutputDir)) {
  fs.mkdirSync(sqlOutputDir, { recursive: true });
}

// 用於收集所有 SQL 語句
const allSqlStatements = [];
allSqlStatements.push('-- 自動生成的合併 SQL 插入語句');
allSqlStatements.push('-- 來源: 所有演講 HTML 文件');
allSqlStatements.push('-- 生成時間: ' + new Date().toISOString());
allSqlStatements.push('');
allSqlStatements.push('-- 使用 INSERT OR IGNORE 避免插入重複的資料');
allSqlStatements.push('');

// 統計資訊
let totalProcessed = 0;
let totalSections = 0;
let totalSpeechSpeakers = 0;
let successCount = 0;
let errorCount = 0;
const errors = [];
const exceptionFiles = []; // 收集例外檔名（所有 section_id 為 null 的檔案）

// 遍歷每個演講項目
speechIndex.forEach((item, index) => {
  const filename = item.filename;
  const htmlPath = path.join(targetFolder, `${filename}.html`);

  console.log(`\n[${index + 1}/${speechIndex.length}] 處理: ${filename}`);

  // 檢查 HTML 文件是否存在
  if (!fs.existsSync(htmlPath)) {
    console.warn(`  警告: HTML 文件不存在: ${htmlPath}`);
    errors.push({ filename, error: 'HTML 文件不存在' });
    errorCount++;
    return;
  }

  try {
    // 讀取 HTML 文件
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const $ = cheerio.load(htmlContent);

    // 找到 <ul class="section-list"> 元素
    const $sectionList = $('ul.section-list');
    if ($sectionList.length === 0) {
      console.warn(`  警告: 找不到 <ul class="section-list"> 元素`);
      errors.push({ filename, error: '找不到 section-list 元素' });
      errorCount++;
      return;
    }

    // 提取所有 <li> 元素
    const $listItems = $sectionList.find('> li');
    console.log(`  找到 ${$listItems.length} 個 <li> 元素`);

    // 解析每個 <li> 元素
    const speechData = [];

    $listItems.each((liIndex, liElement) => {
      const $li = $(liElement);

      // 提取 section_id: 從 <li> 的 id 屬性去掉前面的 "s"
      const liId = $li.attr('id') || '';
      const sectionId = liId.replace(/^s/, '');

      if (!sectionId) {
        console.warn(`  警告: <li> 元素 #${liIndex} 沒有有效的 id`);
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
    speechData.forEach((item, dataIndex) => {
      item.previous_section_id = dataIndex > 0 ? speechData[dataIndex - 1].section_id : null;
      item.next_section_id = dataIndex < speechData.length - 1 ? speechData[dataIndex + 1].section_id : null;
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

    console.log(`  成功解析 ${speechData.length} 筆資料`);
    console.log(`  找到 ${speechSpeakersSet.size} 個唯一的演講-講者關係`);

    // 檢查是否有任何 section_id 是 null（例外情況）
    const anySectionIdNull = speechData.length > 0 && speechData.some(item => item.section_id === null);

    if (anySectionIdNull) {
      console.warn(`  警告: 有 section_id 是 null，將此檔案視為例外，不生成 JSON 和 SQL`);

      // 嘗試從索引頁（即目前讀取的 {filename}.html）抓取巢狀檔案資訊
      const nestedFilenames = [];
      const nestedDisplayNames = [];
      $sectionList.find('span.section-title a').each((_, anchor) => {
        const $a = $(anchor);
        const href = $a.attr('href') || '';
        const parts = href.split('/');
        const tail = parts[parts.length - 1] || '';
        const nestedFilename = decodeURIComponent(tail);
        const nestedDisplayName = $a.text().trim();
        if (nestedFilename) nestedFilenames.push(nestedFilename);
        if (nestedDisplayName) nestedDisplayNames.push(nestedDisplayName);
      });

      exceptionFiles.push({
        filename: filename,
        reason: '有 section_id 是 null',
        sections_count: speechData.length,
        nest_filenames: nestedFilenames.join(','),
        nest_display_names: nestedDisplayNames.join(',')
      });
      errorCount++;
      return; // 跳過後續處理
    }

    // 生成 JSON 文件
    const jsonOutputPath = path.join(jsonOutputDir, `${filename}.json`);
    const jsonContent = JSON.stringify(speechData, null, 2);
    fs.writeFileSync(jsonOutputPath, jsonContent, 'utf8');
    console.log(`  生成 JSON 文件: ${jsonOutputPath}`);

    // 生成 SQL 文件
    let sqlStatements = [];
    sqlStatements.push(`-- 自動生成的 SQL 插入語句`);
    sqlStatements.push(`-- 來源: ${targetFolder}/${filename}.html`);
    sqlStatements.push(`-- 生成時間: ${new Date().toISOString()}`);
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

      const sqlLine = `INSERT OR IGNORE INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES ('${escapedFilename}', NULL, NULL, ${sectionId}, ${previousSectionId}, ${nextSectionId}, ${speakerValue}, ${contentValue});`;
      sqlStatements.push(sqlLine);
      allSqlStatements.push(sqlLine);
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

      const sqlLine = `INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES ('${escapedFilename}', '${escapedSpeaker}');`;
      sqlStatements.push(sqlLine);
      allSqlStatements.push(sqlLine);
    });

    sqlStatements.push('');

    // 寫入個別 SQL 文件
    const sqlOutputPath = path.join(sqlOutputDir, `${filename}.sql`);
    const sqlContent = sqlStatements.join('\n');
    fs.writeFileSync(sqlOutputPath, sqlContent, 'utf8');
    console.log(`  生成 SQL 文件: ${sqlOutputPath}`);

    // 更新統計
    totalSections += speechData.length;
    totalSpeechSpeakers += speechSpeakersSet.size;
    successCount++;

  } catch (error) {
    console.error(`  錯誤: 處理 ${filename} 時發生錯誤:`, error.message);
    errors.push({ filename, error: error.message });
    errorCount++;
  }
});

// 生成合併的 SQL 文件
allSqlStatements.push('');
const mergeSqlPath = path.join(__dirname, '..', 'sql', 'fill-all-speech_content.sql');
const mergeSqlContent = allSqlStatements.join('\n');
fs.writeFileSync(mergeSqlPath, mergeSqlContent, 'utf8');
console.log(`\n生成合併 SQL 文件: ${mergeSqlPath}`);

// 生成例外檔案列表
const exceptionJsonPath = path.join(__dirname, '..', 'data', 'exception.json');
if (exceptionFiles.length > 0) {
  const exceptionContent = JSON.stringify(exceptionFiles, null, 2);
  fs.writeFileSync(exceptionJsonPath, exceptionContent, 'utf8');
  console.log(`\n生成例外檔案列表: ${exceptionJsonPath}`);
  console.log(`例外檔案數量: ${exceptionFiles.length}`);
}

// 輸出統計資訊
console.log('\n=== 處理完成 ===');
console.log(`成功處理: ${successCount} 個演講`);
console.log(`失敗: ${errorCount} 個演講`);
console.log(`總段落數: ${totalSections}`);
console.log(`總演講-講者關係數: ${totalSpeechSpeakers}`);
if (exceptionFiles.length > 0) {
  console.log(`例外檔案: ${exceptionFiles.length} 個（所有 section_id 為 null）`);
}

if (errors.length > 0) {
  console.log('\n錯誤列表:');
  errors.forEach((err) => {
    console.log(`  - ${err.filename}: ${err.error}`);
  });
}

if (exceptionFiles.length > 0) {
  console.log('\n例外檔案列表:');
  exceptionFiles.forEach((ex) => {
    console.log(`  - ${ex.filename}: ${ex.reason} (${ex.sections_count} 個段落)`);
  });
}
