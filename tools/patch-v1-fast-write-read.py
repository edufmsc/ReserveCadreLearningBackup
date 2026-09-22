from pathlib import Path

p = Path('app.js')
s = p.read_text(encoding='utf-8')

def rep(old, new, label, count=1):
    global s
    actual = s.count(old)
    if actual != count:
        raise SystemExit(f'{label}: expected {count}, got {actual}')
    s = s.replace(old, new, count)

old = """  async function saveAdminAction(action, payload) {
    const timeout = action === 'saveContent' && payload?.fileBase64 ? 90000 : ['moveContentsToLesson','reuseContents','copyLesson','copyPackage'].includes(action) ? 120000 : 15000;
    const data = await api(action, payload, state.token, { timeout });
    if (data?.catalog) { state.adminCatalog = data.catalog; state.adminCatalogLoaded = true; }
    if (Array.isArray(data?.overview)) { state.adminOverview = data.overview; state.overviewDirty = false; }
    else state.overviewDirty = true;
    if (data?.user) state.user = data.user;
    renderAdminManage();
    return data;
  }
"""
new = """  function applyAdminFastWrite(data) {
    if (!data?.fastWrite || !state.adminCatalog) return false;
    const catalog = state.adminCatalog;
    catalog.packages = Array.isArray(catalog.packages) ? catalog.packages : [];
    catalog.assignments = Array.isArray(catalog.assignments) ? catalog.assignments : [];
    catalog.learners = Array.isArray(catalog.learners) ? catalog.learners : [];

    if (data.removedPackageId) {
      const id = clean(data.removedPackageId);
      catalog.packages = catalog.packages.filter(pkg => clean(pkg.id) !== id);
      catalog.assignments = catalog.assignments.filter(row => clean(row.packageId) !== id);
      state.manageOpenPackages.delete(id);
    }

    if (data.package?.id) {
      const incoming = data.package;
      const index = catalog.packages.findIndex(pkg => clean(pkg.id) === clean(incoming.id));
      if (index >= 0) catalog.packages[index] = incoming;
      else catalog.packages.push(incoming);
      catalog.packages.sort((a,b) => n(a.sort) - n(b.sort));
    }

    if (Array.isArray(data.assignmentsForPackage)) {
      const packageId = clean(data.packageId);
      catalog.assignments = catalog.assignments
        .filter(row => clean(row.packageId) !== packageId)
        .concat(data.assignmentsForPackage);
    }

    state.adminCatalog = catalog;
    state.adminCatalogLoaded = data.refreshCatalog ? false : true;
    if (data.refreshCatalog) state.adminCatalogLoading = null;
    return true;
  }

  async function saveAdminAction(action, payload) {
    const timeout = action === 'saveContent' && payload?.fileBase64 ? 90000 : ['moveContentsToLesson','reuseContents','copyLesson','copyPackage'].includes(action) ? 120000 : 15000;
    const data = await api(action, payload, state.token, { timeout });
    if (data?.catalog) {
      state.adminCatalog = data.catalog;
      state.adminCatalogLoaded = true;
    } else {
      applyAdminFastWrite(data);
    }
    if (Array.isArray(data?.overview)) { state.adminOverview = data.overview; state.overviewDirty = false; }
    else state.overviewDirty = true;
    if (data?.user) state.user = data.user;
    renderAdminManage();
    return data;
  }
"""
rep(old,new,'fast write apply')

p.write_text(s, encoding='utf-8')

ip = Path('index.html')
html = ip.read_text(encoding='utf-8')
oldv = 'app.js?v=1.0-stability-core-20260922'
newv = 'app.js?v=1.0-fast-write-20260922'
if oldv not in html:
    raise SystemExit('cache bust target not found')
ip.write_text(html.replace(oldv, newv, 1), encoding='utf-8')
