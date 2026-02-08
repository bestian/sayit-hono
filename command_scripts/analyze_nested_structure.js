const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// 讀取 exception.json
const exceptionPath = path.join(__dirname, '..', 'data', 'exception.json');
const exceptions = JSON.parse(fs.readFileSync(exceptionPath, 'utf8'));

// 目標資料夾
const targetFolder = process.argv[2] || path.join(process.env.HOME, 'sayit-archive-static', 'sayit.archive.tw');

console.log('分析例外檔案的巢狀結構...');
console.log(`目標資料夾: ${targetFolder}`);
console.log(`總共 ${exceptions.length} 個例外檔案\n`);

const results = [];

exceptions.forEach((exception, index) => {
  const filename = exception.filename;
  const htmlPath = path.join(targetFolder, `${filename}.html`);
  const dirPath = path.join(targetFolder, filename);

  const result = {
    filename: filename,
    is_directory: false,
    has_html_file: false,
    has_nested_files: false,
    nested_files: [],
    html_structure: null,
    error: null
  };

  try {
    // 檢查是否為目錄
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      result.is_directory = true;

      // 列出目錄中的檔案
      const files = fs.readdirSync(dirPath);
      const htmlFiles = files.filter(f => f.endsWith('.html'));

      if (htmlFiles.length > 0) {
        result.has_nested_files = true;
        result.nested_files = htmlFiles;

        // 檢查第一個巢狀檔案的結構
        if (htmlFiles.length > 0) {
          const firstNestedFile = path.join(dirPath, htmlFiles[0]);
          try {
            const htmlContent = fs.readFileSync(firstNestedFile, 'utf8');
            const $ = cheerio.load(htmlContent);

            // 檢查結構
            const hasSectionList = $('ul.section-list').length > 0;
            const hasBreadcrumbs = $('ul.breadcrumbs').length > 0;
            const sectionCount = $('ul.section-list > li').length;
            const sectionsWithId = $('ul.section-list > li[id^="s"]').length;

            result.html_structure = {
              has_section_list: hasSectionList,
              has_breadcrumbs: hasBreadcrumbs,
              section_count: sectionCount,
              sections_with_id: sectionsWithId,
              all_sections_have_id: sectionCount > 0 && sectionsWithId === sectionCount,
              sample_nested_file: htmlFiles[0]
            };
          } catch (err) {
            result.error = `讀取巢狀檔案錯誤: ${err.message}`;
          }
        }
      }
    } else if (fs.existsSync(htmlPath)) {
      // 檢查是否有對應的 HTML 檔案
      result.has_html_file = true;

      // 分析 HTML 結構
      try {
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const $ = cheerio.load(htmlContent);

        const hasSectionList = $('ul.section-list').length > 0;
        const hasBreadcrumbs = $('ul.breadcrumbs').length > 0;
        const sectionCount = $('ul.section-list > li').length;
        const sectionsWithId = $('ul.section-list > li[id^="s"]').length;

        result.html_structure = {
          has_section_list: hasSectionList,
          has_breadcrumbs: hasBreadcrumbs,
          section_count: sectionCount,
          sections_with_id: sectionsWithId,
          all_sections_have_id: sectionCount > 0 && sectionsWithId === sectionCount
        };
      } catch (err) {
        result.error = `讀取 HTML 檔案錯誤: ${err.message}`;
      }
    } else {
      result.error = '找不到對應的 HTML 檔案或目錄';
    }
  } catch (err) {
    result.error = `檢查錯誤: ${err.message}`;
  }

  results.push(result);

  if ((index + 1) % 10 === 0) {
    console.log(`已處理 ${index + 1}/${exceptions.length}...`);
  }
});

// 統計分析
const directoryCount = results.filter(r => r.is_directory).length;
const htmlFileCount = results.filter(r => r.has_html_file).length;
const nestedFilesCount = results.filter(r => r.has_nested_files).length;
const errorCount = results.filter(r => r.error).length;

console.log('\n=== 統計結果 ===');
console.log(`總檔案數: ${results.length}`);
console.log(`是目錄: ${directoryCount}`);
console.log(`有 HTML 檔案: ${htmlFileCount}`);
console.log(`有巢狀檔案: ${nestedFilesCount}`);
console.log(`有錯誤: ${errorCount}`);

// 分析巢狀結構的一致性
const nestedResults = results.filter(r => r.has_nested_files && r.html_structure);
if (nestedResults.length > 0) {
  console.log('\n=== 巢狀結構分析 ===');
  const structures = nestedResults.map(r => ({
    filename: r.filename,
    has_section_list: r.html_structure.has_section_list,
    has_breadcrumbs: r.html_structure.has_breadcrumbs,
    all_sections_have_id: r.html_structure.all_sections_have_id,
    section_count: r.html_structure.section_count,
    sections_with_id: r.html_structure.sections_with_id
  }));

  const allHaveSectionList = structures.every(s => s.has_section_list);
  const allHaveBreadcrumbs = structures.every(s => s.has_breadcrumbs);
  const allSectionsHaveId = structures.every(s => s.all_sections_have_id);

  console.log(`所有巢狀檔案都有 section-list: ${allHaveSectionList}`);
  console.log(`所有巢狀檔案都有 breadcrumbs: ${allHaveBreadcrumbs}`);
  console.log(`所有巢狀檔案的 section 都有 id: ${allSectionsHaveId}`);

  if (!allSectionsHaveId) {
    console.log('\n有 section 沒有 id 的檔案:');
    structures.filter(s => !s.all_sections_have_id).forEach(s => {
      console.log(`  - ${s.filename}: ${s.sections_with_id}/${s.section_count} 有 id`);
    });
  }
}

// 生成報告
const reportPath = path.join(__dirname, '..', 'design', 'nested_report.md');
const reportDir = path.dirname(reportPath);
if (!fs.existsSync(reportDir)) {
  fs.mkdirSync(reportDir, { recursive: true });
}

let report = `# 巢狀結構分析報告\n\n`;
report += `生成時間: ${new Date().toISOString()}\n\n`;
report += `## 總覽\n\n`;
report += `- 總例外檔案數: ${results.length}\n`;
report += `- 是目錄: ${directoryCount}\n`;
report += `- 有 HTML 檔案: ${htmlFileCount}\n`;
report += `- 有巢狀檔案: ${nestedFilesCount}\n`;
report += `- 有錯誤: ${errorCount}\n\n`;

report += `## 巢狀結構詳細分析\n\n`;

if (nestedResults.length > 0) {
  report += `### 巢狀檔案結構一致性\n\n`;
  const allHaveSectionList = nestedResults.every(r => r.html_structure.has_section_list);
  const allHaveBreadcrumbs = nestedResults.every(r => r.html_structure.has_breadcrumbs);
  const allSectionsHaveId = nestedResults.every(r => r.html_structure.all_sections_have_id);

  report += `- 所有巢狀檔案都有 \`ul.section-list\`: ${allHaveSectionList ? '✅' : '❌'}\n`;
  report += `- 所有巢狀檔案都有 \`ul.breadcrumbs\`: ${allHaveBreadcrumbs ? '✅' : '❌'}\n`;
  report += `- 所有巢狀檔案的 section 都有 id: ${allSectionsHaveId ? '✅' : '❌'}\n\n`;

  report += `### 巢狀檔案列表\n\n`;
  report += `| 檔名 | 巢狀檔案數 | 有 section-list | 有 breadcrumbs | section 總數 | 有 id 的 section | 所有 section 有 id |\n`;
  report += `|------|-----------|----------------|----------------|-------------|-----------------|------------------|\n`;

  nestedResults.forEach(r => {
    const s = r.html_structure;
    report += `| ${r.filename} | ${r.nested_files.length} | ${s.has_section_list ? '✅' : '❌'} | ${s.has_breadcrumbs ? '✅' : '❌'} | ${s.section_count} | ${s.sections_with_id} | ${s.all_sections_have_id ? '✅' : '❌'} |\n`;
  });

  report += `\n### 巢狀檔案內容範例\n\n`;
  const sampleNested = nestedResults[0];
  if (sampleNested) {
    report += `**範例檔案**: ${sampleNested.filename}\n\n`;
    report += `- 巢狀檔案: ${sampleNested.nested_files.join(', ')}\n`;
    report += `- 樣本檔案: ${sampleNested.html_structure.sample_nested_file}\n\n`;
  }
} else {
  report += `沒有找到巢狀結構的檔案。\n\n`;
}

report += `## 所有例外檔案詳細資訊\n\n`;
report += `<details>\n<summary>展開查看所有例外檔案</summary>\n\n`;
report += `| 檔名 | 類型 | 狀態 | 錯誤 |\n`;
report += `|------|------|------|------|\n`;

results.forEach(r => {
  let type = '未知';
  if (r.is_directory) type = '目錄';
  else if (r.has_html_file) type = 'HTML 檔案';

  let status = '';
  if (r.has_nested_files) status = `有 ${r.nested_files.length} 個巢狀檔案`;
  else if (r.has_html_file) status = '單一 HTML 檔案';
  else status = '未找到';

  const error = r.error || '-';
  report += `| ${r.filename} | ${type} | ${status} | ${error} |\n`;
});

report += `\n</details>\n\n`;

fs.writeFileSync(reportPath, report, 'utf8');
console.log(`\n報告已生成: ${reportPath}`);
