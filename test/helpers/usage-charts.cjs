'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const app = fs.readFileSync(path.resolve(__dirname, '../../public/app.js'), 'utf8');
const slice = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
const calls = new Map(), elements = new Map(['chAgentDonut', 'chModelDonut', 'chTrend'].map(id => [id, { id }]));
const chart = id => ({ isDisposed: () => false, getDom: () => elements.get(id), setOption: option => calls.set(id, option), on() {} });
const state = { charts: { chAgentDonut: chart('chAgentDonut'), chModelDonut: chart('chModelDonut'), trend: chart('chTrend') }, sessions: [], _statsData: {} };
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const ui = vm.runInNewContext(
  slice('const CHART_PALETTE =', '\nfunction openTodayUsage(') +
  slice('function dayTokens(', '\nfunction locKey(') +
  slice('function refreshStatsLiveBreakdowns(', '\nfunction selectStatsDay(') +
  slice('function drawTrendChart(', '\n// ---------------- SSH 弹窗') +
  ';({donutDataFromRows,renderStatsDistribution,refreshStatsLiveBreakdowns,drawDonut,drawTrendChart})', {
    S: state, statsRange: 30, statsFilter: {}, esc, fmtWan: String, fmtDurShort: String,
    agentMeta: name => ({ name }), modelMatrixAgentLabel: String, calcStreaks: () => ({ cur: 0, longest: 0 }),
    window: { echarts: true }, echarts: { init: element => chart(element.id) },
    $: selector => elements.get(selector.slice(1)) || null,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    disposeOneChart() {}, observeChartResize() {}, chartInk: () => ({ axisColor: '#555', splitColor: '#ddd' }),
  });
const rows = [{ model: 'alpha', input: 80, requests: 2 }, { model: 'beta', input: 20, requests: 1 }];
const initial = ui.donutDataFromRows(rows, 'model');
const colors = new Map(initial.map(item => [item.name, item.itemStyle.color]));
const updated = [{ model: 'beta', input: 90, requests: 2 }, { model: 'alpha', input: 10, requests: 2 }];
for (const item of ui.donutDataFromRows(updated, 'model')) assert.equal(item.itemStyle.color, colors.get(item.name), 'live rank changes retain each model color');
for (const row of updated) {
  const markup = ui.renderStatsDistribution([row], 'model', 100);
  assert(markup.includes('--dist-color:' + colors.get(row.model)), 'legend and progress bar use the same per-model color as the donut');
}
const rest = ui.donutDataFromRows(rows, 'model', 1);
assert.equal(rest.at(-1).name, '其他'); assert.equal(rest.at(-1).value, 20); assert(rest.at(-1).itemStyle.color);
const tiny = ui.renderStatsDistribution([{ model: 'small', input: 1 }], 'model', 10000);
assert(tiny.includes('&lt;0.1%'), 'a nonzero small share is not rounded to zero');
assert(ui.renderStatsDistribution([{ model: 'missing', requests: 2, usageUnknownRequests: 2 }], 'model', 100).includes('Token 未上报'));
ui.drawDonut('chModelDonut', initial, 100);
assert.deepEqual(JSON.parse(JSON.stringify(calls.get('chModelDonut').series[0].data)), JSON.parse(JSON.stringify(initial)));
ui.drawTrendChart([{ date: '2026-11-10', models: { alpha: 80, beta: 20 } }], ['alpha', 'beta']);
assert.equal(calls.get('chTrend').series[0].itemStyle.color, colors.get('alpha'));
ui.refreshStatsLiveBreakdowns({ byAgent: [], byModel: updated, byDay: [{ date: '2026-11-10', models: { alpha: 10, beta: 90 } }], totals: {} });
const live = calls.get('chModelDonut');
for (const item of live.series[0].data) assert.equal(item.itemStyle.color, colors.get(item.name), 'the live chart option retains explicit slice colors');
assert.equal(live.graphic[0].style.text, '100', 'the live total in the donut center refreshes with its slices');
for (const item of calls.get('chTrend').series) assert.equal(item.itemStyle.color, colors.get(item.name), 'live trends and model distribution use one color mapping');
console.log('[usage-charts] consistent initial/live chart and legend colors, rank changes, center totals, small shares and unknown usage passed');
