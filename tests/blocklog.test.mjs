// 屏蔽记录(blocklog) — 逻辑测试: 从真实脚本文件提取代码段执行
// 注意: 沙箱必须补全被提取函数引用的脚本作用域变量/函数 (currentTab, renderBlocklog 等)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'x-comment-bot-blocker.user.js'), 'utf8');

function extractBrace(name, kind = 'function') {
  const start = src.indexOf(`${kind} ${name}(`);
  if (start < 0) throw new Error(`未找到 ${kind} ${name}`);
  const fnStart = src.indexOf('{', start);
  let depth = 0, i = fnStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
function extractArrow(name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`未找到 const ${name}`);
  const fnStart = src.indexOf('{', start);
  let depth = 0, i = fnStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const saveBlocklogCode = extractArrow('saveBlocklog');
const logBlockCode = extractArrow('logBlock');
const mergeCode = extractBrace('mergeJsonData');
const exportCode = extractBrace('exportJson');
const normalizeCode = extractBrace('normalize');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${detail}`); }
};

// ---- 1. logBlock: 去重/字段/顺序 ----
{
  const saved = {};
  const run = new Function('GM_setValue', `
    let blocklog = [];
    let currentTab = 'tpl'; // 脚本作用域变量(数据页打开时 logBlock 会刷新列表, 测试保持非 data 即可)
    const renderBlocklog = () => {};
    ${saveBlocklogCode}
    ${logBlockCode}
    return { getBlocklog: () => blocklog, logBlock };
  `);
  const { getBlocklog, logBlock } = run((k, v) => { saved[k] = v; });
  const realNow = Date.now;
  Date.now = () => 1000;
  logBlock('usera', '甲', '用户名名单命中');
  Date.now = () => 2000;
  logBlock('userb', '乙', '相似度 0.85');
  Date.now = () => 3000;
  logBlock('usera', '甲2', '评论含关键词: 约炮'); // 同一账号重复屏蔽 → 只留最新(handle 已统一小写, 与脚本调用路径一致)
  Date.now = realNow;

  console.log('— logBlock 基础 —');
  check('记录 2 个不同账号', getBlocklog().length === 2, `实际 ${getBlocklog().length}`);
  check('同账号重复屏蔽只留最新', getBlocklog().find((b) => b.h === 'usera')?.n === '甲2' && !getBlocklog().some((b) => b.h !== 'usera' && b.h !== 'userb'));
  check('字段完整 (h/n/t/r)', getBlocklog().every((b) => b.h && typeof b.n === 'string' && typeof b.t === 'number' && typeof b.r === 'string'));
  check('顺序为追加序(新在后)', getBlocklog()[0].h === 'userb' && getBlocklog()[1].h === 'usera');
  check('写入了 GM 存储', !!saved.xcbb_blocklog && saved.xcbb_blocklog.length === 2);
}

// ---- 2. saveBlocklog: 上限 300 保留最新 ----
{
  const saved = {};
  const run = new Function('GM_setValue', `
    let blocklog = [];
    ${saveBlocklogCode}
    return { getBlocklog: () => blocklog, saveBlocklog };
  `);
  const { getBlocklog, saveBlocklog } = run((k, v) => { saved[k] = v; });
  for (let i = 0; i < 305; i++) getBlocklog().push({ h: 'u' + i, n: '', t: i, r: '' });
  saveBlocklog();
  console.log('— saveBlocklog 上限 —');
  check('超过 300 截断到 300', getBlocklog().length === 300, `实际 ${getBlocklog().length}`);
  check('保留的是最新的 300 条', getBlocklog()[0].h === 'u5' && getBlocklog()[299].h === 'u304');
}

// ---- 3. mergeJsonData: blocklog 合并(去重/新时间戳/排序/上限) ----
{
  const state = { templates: [], badnames: [], commentKws: [], corpus: [], blocklog: [] };
  const run = new Function(
    'templates', 'badnames', 'commentKws', 'corpus', 'blocklog', 'normalize',
    'saveTemplates', 'saveBadnames', 'saveCommentKws', 'saveCorpus', 'saveBlocklog',
    'renderTemplates', 'renderBadnames', 'renderFreq', 'updateOverview', 'log',
    `${mergeCode}\nreturn { mergeJsonData, getBlocklog: () => blocklog };`
  );
  const { mergeJsonData, getBlocklog } = run(
    state.templates, state.badnames, state.commentKws, state.corpus, state.blocklog,
    new Function(normalizeCode + '\nreturn normalize;')(),
    ...[...Array(11)].map(() => () => {})
  );
  // 本地已有: userA@1000
  state.blocklog.push({ h: 'usera', n: '甲', t: 1000, r: '旧原因' });
  const r = mergeJsonData({
    templates: [],
    blocklog: [
      { h: 'usera', n: '甲新', t: 2000, r: '新原因' },  // 更新已有(时间戳更新)
      { h: 'userB', n: '乙', t: 1500, r: '远程原因' },  // 新增
      { h: '', n: '坏数据', t: 9, r: '' },              // 无 handle → 跳过
    ],
  });
  console.log('— mergeJsonData blocklog 合并 —');
  check('远程更新的条目覆盖本地(新时间戳)', getBlocklog().find((b) => b.h === 'usera')?.n === '甲新' && getBlocklog().find((b) => b.h === 'usera')?.r === '新原因');
  check('新条目加入(统一小写)', getBlocklog().some((b) => b.h === 'userb'));
  check('坏数据跳过', getBlocklog().length === 2);
  check('按时间升序排列', getBlocklog()[0].t === 1500 && getBlocklog()[1].t === 2000);
  check('nBlk 计数 = 2 (1更新+1新增)', r.nBlk === 2, `实际 ${r.nBlk}`);
  check('handle 统一小写', getBlocklog()[1].h === 'usera');
  check('旧时间戳不覆盖新记录', getBlocklog().find((b) => b.h === 'usera')?.t === 2000);
  // 老版本数据文件无 blocklog 字段 → 不报错
  const r2 = mergeJsonData({ templates: [], badnames: [] });
  check('无 blocklog 字段不报错且计数 0', r2.nBlk === 0);
}

// ---- 4. exportJson: 携带 blocklog ----
{
  const state = { templates: [], badnames: [], commentKws: [], corpus: [], blocklog: [{ h: 'x1', n: '名', t: 123, r: '因' }] };
  const run = new Function(
    'templates', 'badnames', 'commentKws', 'blocklog', 'corpus',
    `${exportCode}\nreturn { exportJson };`
  );
  const { exportJson } = run(state.templates, state.badnames, state.commentKws, state.blocklog, state.corpus);
  const out = JSON.parse(exportJson());
  console.log('— exportJson —');
  check('包含 blocklog 数组', Array.isArray(out.blocklog) && out.blocklog.length === 1);
  check('字段为 h/n/t/r', out.blocklog[0].h === 'x1' && out.blocklog[0].n === '名' && out.blocklog[0].t === 123 && out.blocklog[0].r === '因');
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
