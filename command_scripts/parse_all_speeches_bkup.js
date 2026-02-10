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
 *   node command_scripts/parse_all_speeches.js ~/sayit-archive-static/sayit.archive.tw
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

// ===== 共用工具 =====
// 修剪 section 內容，移除頭尾多餘空白與過長縮排
const trimSectionContent = (content = '') => {
  let result = content || '';
  result = result.replace(/^\s+(?=<)/, '');
  result = result.replace(/(?<=>)\s+$/, '');
  result = result.replace(/\n\s{2,}/g, '');
  return result;
};

// 解析 section_id：先看 /speech/<id>，再看 li id
const extractSectionId = ($li) => {
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
  return sectionId;
};

// 解析講者路徑 /speaker/<route>
const extractSectionSpeaker = ($li) => {
  let sectionSpeaker = null;
  const $speakerLink = $li.find('span.speech__meta-data__speaker-name a[href]').first();
  if ($speakerLink.length > 0) {
    const speakerHref = $speakerLink.attr('href') || '';
    if (speakerHref.startsWith('/speaker/')) {
      sectionSpeaker = speakerHref.replace('/speaker/', '');
    }
  }
  return sectionSpeaker;
};

// 將 CSV 字串轉為陣列並過濾空值
const splitCsv = (value = '') =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

// SQL 單引號轉義
const escapeSql = (value) => (value || '').replace(/'/g, "''");

// 從母檔抓巢狀連結（適用 isNested）
const collectNestedEntriesFromMother = ($mother) => {
  const entries = [];
  $mother('span.section-title a').each((_, anchor) => {
    const $a = $mother(anchor);
    const href = $a.attr('href') || '';
    const parts = href.split('/');
    const tail = parts[parts.length - 1] || '';
    const nestFilename = decodeURIComponent(tail);
    const nestDisplayName = $a.text().trim();
    if (nestFilename) {
      entries.push({
        nestFilename,
        nestDisplayName: nestDisplayName || nestFilename
      });
    }
  });
  return entries;
};

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

// 統計資訊與紀錄
let totalProcessed = 0;
let totalSections = 0;
let totalSpeechSpeakers = 0;
let successCount = 0;
let errorCount = 0;
const errors = [];
const exceptionFiles = []; // 收集例外檔名（含巢狀與 section_id 問題）
const parseLogs = []; // 產生 parse_log.md 的來源

// ===== 主流程：遍歷每個演講項目 =====
speechIndex.forEach((item, index) => {
  const filename = item.filename;
  const isNested = !!item.isNested;
  const htmlPath = path.join(targetFolder, `${filename}.html`);

  console.log(`\n[${index + 1}/${speechIndex.length}] 處理: ${filename}${isNested ? ' (巢狀)' : ''}`);
  const logEntry = { filename, status: 'pending', notes: [] };
  parseLogs.push(logEntry);

  // 檢查 HTML 文件是否存在
  if (!fs.existsSync(htmlPath)) {
    console.warn(`  警告: HTML 文件不存在: ${htmlPath}`);
    errors.push({ filename, error: 'HTML 文件不存在' });
    logEntry.status = 'error';
    logEntry.notes.push('HTML 不存在，無法解析');
    errorCount++;
    return;
  }

  try {
    // ===== 巢狀流程 =====
    if (isNested) {
      // 讀母檔，取巢狀連結
      const motherContent = fs.readFileSync(htmlPath, 'utf8');
      const $mother = cheerio.load(motherContent);
      let nestedEntries = [];

      // 優先使用 speech_index.json 提供的巢狀列表
      const csvNestFilenames = splitCsv(item.nest_filenames || '');
      const csvNestDisplayNames = splitCsv(item.nest_display_names || '');
      if (csvNestFilenames.length > 0) {
        nestedEntries = csvNestFilenames.map((nestFilename, idx) => ({
          nestFilename,
          nestDisplayName: csvNestDisplayNames[idx] || nestFilename
        }));
      } else {
        nestedEntries = collectNestedEntriesFromMother($mother);
      }

      if (nestedEntries.length === 0) {
        console.warn('  警告: 母檔內無巢狀連結，跳過');
        errors.push({ filename, error: '巢狀連結不存在' });
        logEntry.status = 'error';
        logEntry.notes.push('找不到巢狀連結');
        errorCount++;
        // 仍將此檔案列入例外，方便後續修復
        exceptionFiles.push({
          filename,
          reason: '巢狀連結缺失',
          sections_count: 0,
          nest_filenames: '',
          nest_display_names: ''
        });
        return;
      }

      const speechData = [];
      const speechSpeakersSet = new Set();

      // 逐一解析巢檔
      nestedEntries.forEach((entry, nestIdx) => {
        const nestedHtmlPath = path.join(targetFolder, filename, `${entry.nestFilename}.html`);
        console.log(`  (${nestIdx + 1}/${nestedEntries.length}) 解析巢檔: ${nestedHtmlPath}`);
        logEntry.notes.push(`巢檔: ${entry.nestFilename}`);

        if (!fs.existsSync(nestedHtmlPath)) {
          console.warn(`    警告: 找不到巢檔: ${nestedHtmlPath}`);
          errors.push({ filename, error: `巢檔不存在: ${entry.nestFilename}` });
          return;
        }

        const nestedHtml = fs.readFileSync(nestedHtmlPath, 'utf8');
        const $ = cheerio.load(nestedHtml);
        const $listItems = $('ul.section-list > li');
        console.log(`    找到 ${$listItems.length} 個段落`);

        const sectionItems = [];
        $listItems.each((liIndex, liElement) => {
          const $li = $(liElement);
          const sectionId = extractSectionId($li);
          if (sectionId === null) {
            console.warn(`    警告: 巢檔 ${entry.nestFilename} 的 li #${liIndex} 無 section_id`);
          }

          const sectionSpeaker = extractSectionSpeaker($li);
          const $contentDiv = $li.find('div.speech__content').first();
          const sectionContent = trimSectionContent($contentDiv.length > 0 ? $contentDiv.html() || '' : '');

          sectionItems.push({
            filename,
            nest_filename: entry.nestFilename,
            nest_display_name: entry.nestDisplayName,
            section_id: sectionId,
            previous_section_id: null,
            next_section_id: null,
            section_speaker: sectionSpeaker,
            section_content: sectionContent
          });
        });

        // 設定同一巢檔內的前後段落
        sectionItems.forEach((item, idx) => {
          item.previous_section_id = idx > 0 ? sectionItems[idx - 1].section_id : null;
          item.next_section_id = idx < sectionItems.length - 1 ? sectionItems[idx + 1].section_id : null;
        });

        // 收集講者關係、段落資料
        sectionItems.forEach((item) => {
          if (item.section_speaker) {
            const key = `${filename}||||${item.section_speaker}`;
            speechSpeakersSet.add(key);
          }
          speechData.push(item);
        });
      });

      const anySectionIdNull = speechData.length > 0 && speechData.some((item) => item.section_id === null);
      if (anySectionIdNull) {
        console.warn(`  警告: 巢狀檔案含 null section_id，跳過輸出`);
        errors.push({ filename, error: '巢狀檔案存在 null section_id' });
        logEntry.status = 'error';
        logEntry.notes.push('巢狀段落存在 null section_id');
        errorCount++;
        exceptionFiles.push({
          filename,
          reason: '巢狀段落存在 null section_id',
          sections_count: speechData.length,
          nest_filenames: nestedEntries.map((n) => n.nestFilename).join(','),
          nest_display_names: nestedEntries.map((n) => n.nestDisplayName).join(',')
        });
        return;
      }

      // 產出 JSON
      const jsonOutputPath = path.join(jsonOutputDir, `${filename}.json`);
      fs.writeFileSync(jsonOutputPath, JSON.stringify(speechData, null, 2), 'utf8');
      console.log(`  生成 JSON 文件: ${jsonOutputPath}`);

      // 產出 SQL
      const sqlStatements = [];
      sqlStatements.push(`-- 自動生成的 SQL 插入語句（巢狀資料）`);
      sqlStatements.push(`-- 母檔: ${htmlPath}`);
      sqlStatements.push(`-- 生成時間: ${new Date().toISOString()}`);
      sqlStatements.push('');
      sqlStatements.push('-- 使用 INSERT ... ON CONFLICT(section_id) DO UPDATE 實作 upsert（個別檔案）');
      sqlStatements.push('');

      speechData.forEach((item) => {
        const sectionIdVal = item.section_id !== null ? item.section_id : 'NULL';
        const prevIdVal = item.previous_section_id !== null ? item.previous_section_id : 'NULL';
        const nextIdVal = item.next_section_id !== null ? item.next_section_id : 'NULL';
        const speakerVal = item.section_speaker ? `'${escapeSql(item.section_speaker)}'` : 'NULL';
        const contentVal = item.section_content ? `'${escapeSql(item.section_content)}'` : 'NULL';

        const sqlLineForFile = `INSERT INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES ('${escapeSql(item.filename)}', '${escapeSql(item.nest_filename)}', '${escapeSql(item.nest_display_name)}', ${sectionIdVal}, ${prevIdVal}, ${nextIdVal}, ${speakerVal}, ${contentVal}) ON CONFLICT(section_id) DO UPDATE SET filename = excluded.filename, nest_filename = excluded.nest_filename, nest_display_name = excluded.nest_display_name, previous_section_id = excluded.previous_section_id, next_section_id = excluded.next_section_id, section_speaker = excluded.section_speaker, section_content = excluded.section_content;`;
        const sqlLineForMerge = `INSERT OR IGNORE INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES ('${escapeSql(item.filename)}', '${escapeSql(item.nest_filename)}', '${escapeSql(item.nest_display_name)}', ${sectionIdVal}, ${prevIdVal}, ${nextIdVal}, ${speakerVal}, ${contentVal});`;
        sqlStatements.push(sqlLineForFile);
        allSqlStatements.push(sqlLineForMerge);
      });

      sqlStatements.push('');
      sqlStatements.push('-- 演講-講者關係');
      sqlStatements.push('-- 使用 INSERT OR IGNORE 避免重複的 (speech_filename, speaker_route_pathname)');
      sqlStatements.push('');

      speechSpeakersSet.forEach((key) => {
        const [speechFilename, speakerRoute] = key.split('||||');
        const sqlLine = `INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES ('${escapeSql(speechFilename)}', '${escapeSql(speakerRoute)}');`;
        sqlStatements.push(sqlLine);
        allSqlStatements.push(sqlLine);
      });

      sqlStatements.push('');
      const sqlOutputPath = path.join(sqlOutputDir, `${filename}.sql`);
      fs.writeFileSync(sqlOutputPath, sqlStatements.join('\n'), 'utf8');
      console.log(`  生成 SQL 文件: ${sqlOutputPath}`);

      // 更新統計
      totalSections += speechData.length;
      totalSpeechSpeakers += speechSpeakersSet.size;
      successCount++;
      logEntry.status = 'success';
      logEntry.notes.push(`巢狀段落數: ${speechData.length}`);

      // 仍維持例外紀錄，確保 speech_index.json 可追蹤巢狀來源
      exceptionFiles.push({
        filename,
        reason: '巢狀檔案 (isNested)',
        sections_count: speechData.length,
        nest_filenames: nestedEntries.map((n) => n.nestFilename).join(','),
        nest_display_names: nestedEntries.map((n) => n.nestDisplayName).join(',')
      });

      return;
    }

    // ===== 非巢狀流程 =====
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const $ = cheerio.load(htmlContent);

    const $sectionList = $('ul.section-list');
    if ($sectionList.length === 0) {
      console.warn(`  警告: 找不到 <ul class="section-list"> 元素`);
      errors.push({ filename, error: '找不到 section-list 元素' });
      logEntry.status = 'error';
      logEntry.notes.push('缺少 section-list');
      errorCount++;
      return;
    }

    const $listItems = $sectionList.find('> li');
    console.log(`  找到 ${$listItems.length} 個 <li> 元素`);

    const speechData = [];
    $listItems.each((liIndex, liElement) => {
      const $li = $(liElement);
      const liId = $li.attr('id') || '';
      const sectionId = liId.replace(/^s/, '');
      if (!sectionId) {
        console.warn(`  警告: <li> 元素 #${liIndex} 沒有有效的 id`);
      }

      const $speakerLink = $li.find('span.speech__meta-data__speaker-name a');
      let sectionSpeaker = null;
      if ($speakerLink.length > 0) {
        const href = $speakerLink.attr('href') || '';
        sectionSpeaker = href.replace(/^\/speaker\//, '');
        if (sectionSpeaker === href) {
          sectionSpeaker = null;
        }
      }

      const $contentDiv = $li.find('div.speech__content');
      const sectionContent = trimSectionContent($contentDiv.length > 0 ? $contentDiv.html() || '' : '');

      speechData.push({
        filename,
        nest_filename: null,
        nest_display_name: null,
        section_id: sectionId ? parseInt(sectionId, 10) : null,
        section_speaker: sectionSpeaker,
        section_content: sectionContent
      });
    });

    // 建立前後段落連結
    speechData.forEach((item, dataIndex) => {
      item.previous_section_id = dataIndex > 0 ? speechData[dataIndex - 1].section_id : null;
      item.next_section_id = dataIndex < speechData.length - 1 ? speechData[dataIndex + 1].section_id : null;
    });

    const speechSpeakersSet = new Set();
    speechData.forEach((item) => {
      if (item.section_speaker) {
        const key = `${item.filename}||||${item.section_speaker}`;
        speechSpeakersSet.add(key);
      }
    });

    console.log(`  成功解析 ${speechData.length} 筆資料`);
    console.log(`  找到 ${speechSpeakersSet.size} 個唯一的演講-講者關係`);

    const anySectionIdNull = speechData.length > 0 && speechData.some((item) => item.section_id === null);
    if (anySectionIdNull) {
      console.warn(`  警告: 有 section_id 是 null，將此檔案視為例外，不生成 JSON 和 SQL`);

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
        filename,
        reason: '有 section_id 是 null',
        sections_count: speechData.length,
        nest_filenames: nestedFilenames.join(','),
        nest_display_names: nestedDisplayNames.join(',')
      });
      logEntry.status = 'error';
      logEntry.notes.push('存在 null section_id，已列入例外');
      errorCount++;
      return;
    }

    const jsonOutputPath = path.join(jsonOutputDir, `${filename}.json`);
    fs.writeFileSync(jsonOutputPath, JSON.stringify(speechData, null, 2), 'utf8');
    console.log(`  生成 JSON 文件: ${jsonOutputPath}`);

    const sqlStatements = [];
    sqlStatements.push(`-- 自動生成的 SQL 插入語句`);
    sqlStatements.push(`-- 來源: ${targetFolder}/${filename}.html`);
    sqlStatements.push(`-- 生成時間: ${new Date().toISOString()}`);
    sqlStatements.push('');
    sqlStatements.push('-- 使用 INSERT ... ON CONFLICT(section_id) DO UPDATE 實作 upsert（個別檔案）');
    sqlStatements.push('');

    speechData.forEach((item) => {
      const sectionId = item.section_id !== null ? item.section_id : 'NULL';
      const previousSectionId = item.previous_section_id !== null ? item.previous_section_id : 'NULL';
      const nextSectionId = item.next_section_id !== null ? item.next_section_id : 'NULL';
      const speakerValue = item.section_speaker ? `'${escapeSql(item.section_speaker)}'` : 'NULL';
      const contentValue = item.section_content ? `'${escapeSql(item.section_content)}'` : 'NULL';

      const sqlLineForFile = `INSERT INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES ('${escapeSql(item.filename)}', NULL, NULL, ${sectionId}, ${previousSectionId}, ${nextSectionId}, ${speakerValue}, ${contentValue}) ON CONFLICT(section_id) DO UPDATE SET filename = excluded.filename, nest_filename = excluded.nest_filename, nest_display_name = excluded.nest_display_name, previous_section_id = excluded.previous_section_id, next_section_id = excluded.next_section_id, section_speaker = excluded.section_speaker, section_content = excluded.section_content;`;
      const sqlLineForMerge = `INSERT OR IGNORE INTO speech_content (filename, nest_filename, nest_display_name, section_id, previous_section_id, next_section_id, section_speaker, section_content) VALUES ('${escapeSql(item.filename)}', NULL, NULL, ${sectionId}, ${previousSectionId}, ${nextSectionId}, ${speakerValue}, ${contentValue});`;
      sqlStatements.push(sqlLineForFile);
      allSqlStatements.push(sqlLineForMerge);
    });

    sqlStatements.push('');
    sqlStatements.push('-- 插入演講-講者關係到 speech_speakers 表');
    sqlStatements.push('-- 使用 INSERT OR IGNORE 避免插入重複的 (speech_filename, speaker_route_pathname) 組合');
    sqlStatements.push('');

    speechSpeakersSet.forEach((key) => {
      const [speechFilename, speakerRoutePathname] = key.split('||||');
      const sqlLine = `INSERT OR IGNORE INTO speech_speakers (speech_filename, speaker_route_pathname) VALUES ('${escapeSql(speechFilename)}', '${escapeSql(speakerRoutePathname)}');`;
      sqlStatements.push(sqlLine);
      allSqlStatements.push(sqlLine);
    });

    sqlStatements.push('');
    const sqlOutputPath = path.join(sqlOutputDir, `${filename}.sql`);
    fs.writeFileSync(sqlOutputPath, sqlStatements.join('\n'), 'utf8');
    console.log(`  生成 SQL 文件: ${sqlOutputPath}`);

    totalSections += speechData.length;
    totalSpeechSpeakers += speechSpeakersSet.size;
    successCount++;
    logEntry.status = 'success';
    logEntry.notes.push(`段落數: ${speechData.length}`);
  } catch (error) {
    console.error(`  錯誤: 處理 ${filename} 時發生錯誤:`, error.message);
    errors.push({ filename, error: error.message });
    logEntry.status = 'error';
    logEntry.notes.push(`錯誤: ${error.message}`);
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

// 生成 parse_log.md 報告，紀錄本次解析摘要
const parseLogPath = path.join(__dirname, '..', 'parse_log.md');
let parseLogMd = `# 解析報告 (parse_all_speeches)\n\n`;
parseLogMd += `生成時間: ${new Date().toISOString()}\n\n`;
parseLogMd += `## 摘要\n`;
parseLogMd += `- 成功: ${successCount}\n`;
parseLogMd += `- 失敗: ${errorCount}\n`;
parseLogMd += `- 總段落數: ${totalSections}\n`;
parseLogMd += `- 總講者關係數: ${totalSpeechSpeakers}\n`;
parseLogMd += `- 例外檔案: ${exceptionFiles.length}\n\n`;
parseLogMd += `## 詳細紀錄\n`;
parseLogMd += `| 檔名 | 狀態 | 備註 |\n`;
parseLogMd += `|------|------|------|\n`;
parseLogs.forEach((log) => {
  const notes = log.notes.join('；') || '-';
  parseLogMd += `| ${log.filename} | ${log.status} | ${notes} |\n`;
});
fs.writeFileSync(parseLogPath, parseLogMd, 'utf8');
console.log(`\n生成解析報告: ${parseLogPath}`);

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
