// 评论关键词独立列表 — 逻辑测试(从真实脚本文件提取代码段执行, 保证与线上一致)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'x-comment-bot-blocker.user.js'), 'utf8');

// —— 从真实文件提取纯函数/常量 ——
function extractBrace(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`未找到 function ${name}`);
  const fnStart = src.indexOf('{', start);
  let depth = 0, i = fnStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
function extractArray(name) {
  const m = src.match(new RegExp(`const ${name} = \\[[\\s\\S]*?\\n  \\];`));
  if (!m) throw new Error(`未找到 const ${name}`);
  return m[0];
}
const code = [
  extractArray('BUILTIN_LOW'),
  extractBrace('normalize'),
  extractBrace('nameMatches'),
].join('\n');

const run = new Function('commentKws', `
  ${code}
  // 以下为脚本内真实逻辑的逐字副本(processArticle 中 kw 匹配循环 + commentKwList 定义)
  const COMMENT_KW_EXCLUDE = new Set(['一夜情', '处女', '处子', '脱衣', '女仆', '选妃', '赌博', '网赌', '刷单']);
  function commentKwList() {
    return [...commentKws, ...BUILTIN_LOW.filter((w) => !COMMENT_KW_EXCLUDE.has(w))];
  }
  function kwHit(norm) {
    for (const kw of commentKwList()) {
      if (nameMatches(norm, kw)) return kw;
    }
    return null;
  }
  return { kwHit, commentKwList, nameMatches, normalize, BUILTIN_LOW };
`);

const { kwHit, commentKwList, nameMatches, normalize, BUILTIN_LOW } = run([]);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${detail}`); }
};

// 1. 回归: 上报的 4 条误杀评论, 空自定义列表时必须全部不命中
const reported = [
  '这不很现实吗？我初中晚自习就上到十点了，高中十点半。',
  '各地区不一样吧，我高中因为学校小，全走读，七点五十放差不多',
  '什麼鬼，台灣高中都是五六點放學的',
  '我在山东上高中，高一高二晚十点放学，高三晚十点半，早上六点上第一节早自习。再加时真的要…',
];
console.log('— 回归: 上报误杀评论(空自定义列表) —');
reported.forEach((c, i) => {
  const norm = normalize(c);
  check(`误杀评论#${i + 1} 不命中 (norm="${norm.slice(0, 20)}…")`, kwHit(norm) === null, `→ 命中: ${kwHit(norm)}`);
});

// 2. 用户名单中的普通词不再参与评论匹配(即使它们存在于名单, 匹配源与名单独立)
console.log('— 名单普通词不参与评论匹配 —');
for (const w of ['高中', '免费', '学生', '快速', '线下', '上门']) {
  check(`"${w}" 不在评论关键词源中`, !commentKwList().includes(w));
}

// 3. 正向: 内置低风险词仍命中
console.log('— 内置低风险词仍命中 —');
check('评论"约炮加微信" 命中 约炮', kwHit(normalize('约炮 加微信')) === '约炮');
check('评论"裸聊直播" 命中 裸聊', kwHit(normalize('裸聊直播')) === '裸聊');
check('评论"炮友找上门" 命中 炮友', kwHit(normalize('炮友 找上门')) === '炮友');

// 4. 自定义列表生效(显式开启)
console.log('— 自定义列表(显式添加才生效) —');
const run2 = run(['高中']);
check('自定义加入"高中"后, 误杀评论#1 命中', run2.kwHit(normalize(reported[0])) === '高中');
const run3 = run(['/高中\\s*十点半/']);
check('自定义正则 /高中\\s*十点半/ 命中评论#1', run3.kwHit(normalize(reported[0])) === '/高中\\s*十点半/');
check('正则不匹配"台湾高中都是五六点放学"', run3.kwHit(normalize(reported[2])) === null);
const run4 = run(['约炮']);
check('自定义列表与内置重复时无异常(命中 约炮)', run4.kwHit(normalize('约炮 加微信')) === '约炮');

// 5. 排除的常见词不参与评论匹配, 但仍保留在名字匹配维度
console.log('— 常见词排除(仍可用于用户名匹配) —');
for (const w of ['脱衣', '处女', '处子', '一夜情', '女仆', '选妃', '赌博', '网赌', '刷单']) {
  check(`"${w}" 不在评论关键词源中`, !commentKwList().includes(w), `→ 仍在源中`);
  check(`"${w}" 仍可匹配用户名(名单维度不受影响)`, nameMatches('某某' + w + '老师30+', w));
}
check('评论"赶紧脱衣服睡觉" 不命中(脱衣已排除)', kwHit(normalize('赶紧脱衣服睡觉')) === null);
check('评论"远离赌博" 不命中(赌博已排除)', kwHit(normalize('远离赌博')) === null);

// 6. 数量
console.log('— 数量 —');
check(`BUILTIN_LOW 共 ${BUILTIN_LOW.length} 条`, BUILTIN_LOW.length === 63);
check(`评论关键词源 = 63 - 9 排除 = ${commentKwList().length} 条`, commentKwList().length === 54);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
