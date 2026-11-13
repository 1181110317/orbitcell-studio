'use strict';
const assert=require('node:assert/strict');
const budget=require('../../lib/web-research').createBudget();
budget.record('web_fetch',{url:'https://example.test/a',max_chars:200},{output:'[HTTP 200] https://example.test/a\n\n'+'x'.repeat(200)});
assert.equal(budget.cached('web_fetch',{url:'https://example.test/a',max_chars:8000}),null,'a larger requested excerpt may obtain new content');
assert(budget.cached('web_fetch',{url:'https://example.test/a#fragment',max_chars:200}));
assert.equal(budget.cached('web_search',null),null,'malformed arguments do not abort the loop before tool validation');
console.log('[web-research] larger excerpts remain readable while equivalent URLs reuse their existing results');
