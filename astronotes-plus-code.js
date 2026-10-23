/* Plus Code input and explicit candidate selection. The OLC algorithm is the
 * unmodified, pinned Apache-2.0 implementation in astronotes-open-location-code.js. */
(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports
    ? require('./astronotes-open-location-code.js') : root.OpenLocationCode);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AstroNotesPlusCode = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function(olc) {
  'use strict';
  const invalid = 'Plus Codeを読めませんでした。コードを確認して、もう一度貼り付けてください。';
  function parse(value) {
    const text = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
    // Match a standalone code, not arbitrary '+' in a name, URL, or coordinates.
    if (/^https?:/i.test(text)) return null;
    const tokens = text.split(' '), candidates = [];
    tokens.forEach((token, index) => {
      token = token.replace(/^[,、]+|[,、]+$/g, '');
      const m = token.match(/^([a-z0-9]*)\+([a-z0-9]*)$/i);
      if (!m) return;
      const codePrefix = /^[23456789CFGHJMPQRVWX]*$/i.test(m[1]);
      // Infer malformed codes only from a code-like prefix. Ordinary business
      // names such as BOOK+CAFE and Cafe+Bar still use the name search.
      if (olc.isValid(token) || (m[1].length === 8 && (codePrefix || /\d/.test(m[1])))
        || (codePrefix && /\d/.test(m[1]) && m[1].length % 2 === 0 && m[2].length >= 2)) candidates.push({token,index});
    });
    if (!candidates.length) return null;
    if (candidates.length !== 1) return {kind:'invalid', message:invalid};
    const {token,index} = candidates[0], code = token.toUpperCase();
    if (!olc.isValid(code)) return {kind:'invalid', message:invalid};
    const locality = tokens.filter((_, i) => i !== index).join(' ').replace(/^[,、]+\s*|\s*[,、]+$/g, '');
    if (olc.isFull(code)) return {kind:'full', code, locality};
    if (olc.isShort(code)) return {kind:'short', code, locality};
    return {kind:'invalid', message:invalid};
  }
  function result(code, reference) {
    const area = olc.decode(code), latitude = area.latitudeCenter, longitude = area.longitudeCenter;
    const height = (area.latitudeHi - area.latitudeLo) * 111320;
    const width = (area.longitudeHi - area.longitudeLo) * 111320 * Math.cos(latitude * Math.PI / 180);
    const size = m => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + 'km' : Math.max(1, Math.round(m)) + 'm';
    return {name:code, latitude, longitude, scope:'point', source:'plus-code', kind:'Plus Code',
      plusCode:code, codeArea:{south:area.latitudeLo, west:area.longitudeLo, north:area.latitudeHi, east:area.longitudeHi},
      zoom:Math.max(2, Math.min(18, Math.floor(Math.log2(360 / Math.max(area.latitudeHi - area.latitudeLo, area.longitudeHi - area.longitudeLo))) - 2)),
      detail:[reference ? `基準の地名：${reference.name} — ${reference.detail || reference.address || ''}` : '',
        `区画の中心・約${size(width)} × ${size(height)}。地図で位置を確認・調整できます。`].filter(Boolean).join(' ／ ')};
  }
  async function resolve(input, searchLocality) {
    if (!input) return null;
    if (input.kind === 'invalid') return {results:[], message:input.message};
    if (input.kind === 'full') return {results:[result(input.code)]};
    if (!input.locality) return {results:[], message:'短いPlus Codeには地域名が必要です。コードの後に市区町村名などを加えるか、完全なコードを貼り付けてください。'};
    let references;
    try { references = await searchLocality(input.locality); }
    catch { return {results:[], message:'地域名を検索できませんでした。もう一度検索するか、完全なPlus Codeを貼り付けてください。'}; }
    const results = [], seen = new Set();
    for (const reference of references) {
      const {latitude, longitude} = reference;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
      const full = olc.recoverNearest(input.code, latitude, longitude);
      if (seen.has(full)) continue;
      seen.add(full); results.push(result(full, reference));
    }
    if (results.length) return {results, message:'地域名を基準に補完した候補です。場所を確認して選んでください。'};
    return {results:[], message:references.searchFailed
      ? '地域名の検索先に接続できませんでした。もう一度検索するか、完全なPlus Codeを貼り付けてください。'
      : '地域名が見つかりませんでした。都道府県や国名を加えるか、完全なPlus Codeを貼り付けてください。'};
  }
  return {parse, resolve};
});
