// Region > Province > City/Municipality > Barangay data. Same hierarchy and data as
// https://github.com/wilfredpine/philippine-address-selector (MIT), rebuilt without jQuery and
// split into small files (data/ph/...) so a barangay list loads only when its city is chosen.
const PHAddr = {
  cache: new Map(),
  load(path) {
    if (!PHAddr.cache.has(path)) {
      PHAddr.cache.set(path, fetch(FH.root + 'data/ph/' + path).then(r => {
        if (r.status === 404) return [];
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).catch(e => { PHAddr.cache.delete(path); throw e; }));
    }
    return PHAddr.cache.get(path);
  },
  regions: () => PHAddr.load('region.json'),
  provinces: rc => PHAddr.load('province.json').then(a => a.filter(x => x.r === rc)),
  // One file per province holds its cities and their barangays: [{ c, n, b: [{ c, n }] }]
  province: pc => PHAddr.load('province/' + encodeURIComponent(pc) + '.json'),
  cities: pc => PHAddr.province(pc).then(a => a.map(x => ({ c: x.c, n: x.n }))),
  barangays: (cc, pc) => PHAddr.province(pc).then(a => (a.find(x => x.c === cc) || { b: [] }).b)
};
