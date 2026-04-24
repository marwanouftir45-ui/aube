// ══════════════════════════════
// URLS & CONFIG
// ══════════════════════════════
const RENNES_URL_EST    = 'https://raw.githubusercontent.com/leabourhis2/aubepine/b6173266eca8785a0e8d890f4f8819150a4e5509/RennesEst.geojson';
const RENNES_URL_OUEST  = 'https://raw.githubusercontent.com/leabourhis2/aubepine/b6173266eca8785a0e8d890f4f8819150a4e5509/RennesOuest.geojson';
const RM_URL_EST        = 'https://raw.githubusercontent.com/leabourhis2/aubepine/b6173266eca8785a0e8d890f4f8819150a4e5509/arbreRMest.geojson';
const RM_URL_OUEST      = 'https://raw.githubusercontent.com/leabourhis2/aubepine/b6173266eca8785a0e8d890f4f8819150a4e5509/arbreRMouest.geojson';
const OSM_URL           = 'https://raw.githubusercontent.com/marwanouftir45-ui/aube/ab8bfa8233991de89c9878f0f964accd6828834c/arbres35OSM.geojson';
const NATIONAL_URL      = 'https://raw.githubusercontent.com/marwanouftir45-ui/aube/582e78e3463f36e003bec98f6bfb1a6432ee2445/Arbrenationale.geojson';

// Communes 35 (affichage) + RM (top10/densité seulement)
const COMMUNES_IV_API   = 'https://geo.api.gouv.fr/departements/35/communes?format=geojson&geometry=contour';
const COMMUNES_RM_API   = 'https://geo.api.gouv.fr/epcis/243500139/communes?format=geojson&geometry=contour';

// ══════════════════════════════
// FONDS DE CARTE
// Approche finale :
//   - Style de base = CartoDB Dark Matter (GL JSON) — chargé une seule fois, jamais changé
//   - OSM et Ortho = sources raster ajoutées au load, masquées par défaut
//   - switchBasemap() change juste la visibilité des layers raster
//   - Zéro setStyle, zéro rechargement, zéro perte de couches
// ══════════════════════════════
const BASE_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';

const OVERLAY_SOURCES = {
  osm: {
    type: 'raster',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors'
  },
  ortho: {
    type: 'raster',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256, maxzoom: 19, attribution: '© Esri / Maxar'
  }
};
const TREE_RADIUS_EXPR = ['interpolate', ['exponential', 1.35], ['zoom'],
  6, 0.35,
  8, 0.65,
  10, 1.15,
  12, 2.0,
  16, 5.8
];
const TREE_OPACITY_EXPR = ['interpolate', ['linear'], ['zoom'],
  6, 0.22,
  8, 0.3,
  10, 0.46,
  14, 0.82
];
const TREE_STROKE_WIDTH_EXPR = ['interpolate', ['linear'], ['zoom'],
  6, 0,
  9, 0.15,
  12, 0.3,
  16, 0.4
];
// Les layers OSM et ortho seront insérés juste AU-DESSUS du dernier layer
// du style CartoDB mais EN-DESSOUS de toutes nos couches de données.
// On mémorise l'id du premier layer de données ajouté pour s'y référer.
var firstDataLayerId = null; // sera défini après ajout du cadastre

// ══════════════════════════════
// ÉTAT GLOBAL
// 3 bases : OpenData (#4ade80) | OSM (#60a5fa) | National (#f472b6)
// ══════════════════════════════
let allFeaturesOpenData  = [];
let allFeaturesOSM       = [];
let allFeaturesNational  = [];
let communesIVData       = null;
let communesRMData       = null;
let maxArbreCount        = 1;
let featureGridIndexes   = { od:null, osm:null, nat:null };
let communeGridIndex     = null;
let communeMetaByCode    = {};
let communeStatsByCode   = {};
let spatialCacheStatus   = 'idle';
let spatialCacheToken    = 0;
let spatialCacheCallbacks= [];

let selectedId           = null;
let currentCommune       = null;

let drawMode             = false;
let drawPoints           = [];
let drawMarkers          = [];

let chartDonutGlobal     = null;
let chartCommuneDonut    = null;
let chartEssence         = null;
let currentBasemap       = 'dark';
let qualityAnomalyStats    = { total:0, missingEssence:0, missingHeight:0, missingBoth:0, totalTrees:0 };

// ── Filtres dynamiques ──
// essenceFilter  : ensemble des essences sélectionnées (null = toutes)
var essenceFilter     = null; // null = pas de filtre essence
var essenceIndex      = {};   // { nomEssence: count } construit au chargement
var ESSENCE_FIELD_OD  = ['nom_commun','libelle_fr','essence','genre_lati']; // champs OpenData à essayer
var ESSENCE_FIELD_OSM = ['species','genus','name'];
var ESSENCE_FIELD_NAT = ['nom_commun','essence','libelle_fr','genre_francais'];
var FEATURE_GRID_SIZE = 0.02; // ~2 km
var COMMUNE_GRID_SIZE = 0.05; // ~5 km

// ══════════════════════════════
// CARTE
// ══════════════════════════════
const map = new maplibregl.Map({
  container: 'map',
  style: BASE_STYLE,
  center: [-1.55, 48.15],
  zoom: 9,
  antialias: true
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

// ══════════════════════════════
// TOAST
// ══════════════════════════════
function toast(msg, color) {
  color = color || '#4ade80';
  var el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = '<span class="toast-dot" style="background:'+color+'"></span>'+msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(function(){ el.remove(); }, 3600);
}

// ══════════════════════════════
// LOADING
// ══════════════════════════════
function setLoading(on) {
  var el = document.getElementById('loading-indicator');
  if (on) el.classList.remove('loading-hidden');
  else    el.classList.add('loading-hidden');
}

function setPanelSectionExpanded(sectionId, expanded) {
  var section = document.getElementById(sectionId);
  if (!section) return;
  section.classList.toggle('is-collapsed', !expanded);
  var toggle = section.querySelector('.section-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function initPanelSections() {
  document.querySelectorAll('#right-panel .panel-collapsible').forEach(function(section) {
    var toggle = section.querySelector('.section-toggle');
    if (!toggle || toggle.dataset.bound === '1') return;

    setPanelSectionExpanded(section.id, section.dataset.defaultOpen !== 'false');
    toggle.addEventListener('click', function() {
      setPanelSectionExpanded(section.id, section.classList.contains('is-collapsed'));
    });
    toggle.dataset.bound = '1';
  });
}

// ══════════════════════════════
// HELPERS
// ══════════════════════════════
function processGeoJSON(data) {
  return {
    type: 'FeatureCollection',
    features: data.features
      .filter(function(f){ return f.properties.geo_point_2d && f.properties.geo_point_2d.lon && f.properties.geo_point_2d.lat; })
      .map(function(f){
        return { type:'Feature',
          geometry:{ type:'Point', coordinates:[f.properties.geo_point_2d.lon, f.properties.geo_point_2d.lat] },
          properties: Object.assign({}, f.properties, { categorie:'OpenData' }) };
      })
  };
}

function processOSM(data) {
  return {
    type: 'FeatureCollection',
    features: data.features
      .filter(function(f){ return f.geometry && f.geometry.type==='Point' && f.geometry.coordinates && f.geometry.coordinates.length===2; })
      .map(function(f){ return Object.assign({}, f, { properties: Object.assign({}, f.properties, { categorie:'OSM' }) }); })
  };
}

function processNational(data) {
  return {
    type: 'FeatureCollection',
    features: data.features
      .filter(function(f){
        if (f.geometry && f.geometry.type==='Point' && f.geometry.coordinates && f.geometry.coordinates.length===2) return true;
        if (f.properties && f.properties.geo_point_2d && f.properties.geo_point_2d.lon) return true;
        return false;
      })
      .map(function(f){
        var coords = (f.geometry && f.geometry.type==='Point')
          ? f.geometry.coordinates
          : [f.properties.geo_point_2d.lon, f.properties.geo_point_2d.lat];
        return { type:'Feature', geometry:{ type:'Point', coordinates:coords },
          properties: Object.assign({}, f.properties, { categorie:'National' }) };
      })
  };
}

function animateCount(el, target, duration) {
  duration = duration || 700;
  var start = performance.now();
  var from = parseInt((el.textContent||'0').replace(/[\s\u202f]/g,'')) || 0;
  function step(now) {
    var p = Math.min((now-start)/duration, 1);
    var ease = 1 - Math.pow(1-p, 3);
    el.textContent = Math.round(from + (target-from)*ease).toLocaleString('fr-FR');
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function fmt(n) { return n.toLocaleString('fr-FR'); }

function getCommuneCode(feature) {
  if (!feature || !feature.properties) return '';
  return String(feature.properties.code || feature.id || '');
}

function resolveCommuneFeature(feature) {
  var code = getCommuneCode(feature);
  if (code && communeMetaByCode[code] && communeMetaByCode[code].feature) {
    return communeMetaByCode[code].feature;
  }
  if (code && communesIVData && communesIVData.features) {
    for (var i = 0; i < communesIVData.features.length; i++) {
      if (getCommuneCode(communesIVData.features[i]) === code) return communesIVData.features[i];
    }
  }
  return feature;
}

function getCommuneTreeCharterStatus(featureOrName) {
  var name = '';
  if (typeof featureOrName === 'string') {
    name = featureOrName;
  } else if (featureOrName && featureOrName.properties) {
    name = featureOrName.properties.nom || '';
  }

  var isSigned = name.trim().toLowerCase() === 'rennes';
  return {
    signed: isSigned,
    label: isSigned ? 'Signee' : 'Non signee',
    note: isSigned
      ? 'Rennes a signe une charte de l’arbre.'
      : (name || 'Cette commune') + " n'a pas signe de charte de l'arbre."
  };
}

function getFeaturesForSourceKey(key) {
  if (key === 'od')  return allFeaturesOpenData;
  if (key === 'osm') return allFeaturesOSM;
  if (key === 'nat') return allFeaturesNational;
  return [];
}

function gridCoord(value, cellSize) {
  return Math.floor(value / cellSize);
}

function gridKey(ix, iy) {
  return ix + '|' + iy;
}

function buildFeatureGridIndex(features, cellSize) {
  var grid = {};
  features.forEach(function(f) {
    var c = f.geometry.coordinates;
    var key = gridKey(gridCoord(c[0], cellSize), gridCoord(c[1], cellSize));
    if (!grid[key]) grid[key] = [];
    grid[key].push(f);
  });
  return { cellSize: cellSize, grid: grid };
}

function queryFeatureGrid(index, bbox) {
  if (!index) return [];
  var out = [];
  var minX = gridCoord(bbox[0], index.cellSize);
  var maxX = gridCoord(bbox[2], index.cellSize);
  var minY = gridCoord(bbox[1], index.cellSize);
  var maxY = gridCoord(bbox[3], index.cellSize);

  for (var ix = minX; ix <= maxX; ix++) {
    for (var iy = minY; iy <= maxY; iy++) {
      var cell = index.grid[gridKey(ix, iy)];
      if (!cell || !cell.length) continue;
      for (var i = 0; i < cell.length; i++) out.push(cell[i]);
    }
  }
  return out;
}

function buildCommuneSpatialIndex() {
  if (!communesIVData) return;
  communeGridIndex = { cellSize: COMMUNE_GRID_SIZE, grid: {} };
  communeMetaByCode = {};

  communesIVData.features.forEach(function(feature) {
    var code = getCommuneCode(feature);
    if (!code) return;

    var bb = turf.bbox(feature);
    communeMetaByCode[code] = { feature: feature, bb: bb };

    var minX = gridCoord(bb[0], COMMUNE_GRID_SIZE);
    var maxX = gridCoord(bb[2], COMMUNE_GRID_SIZE);
    var minY = gridCoord(bb[1], COMMUNE_GRID_SIZE);
    var maxY = gridCoord(bb[3], COMMUNE_GRID_SIZE);

    for (var ix = minX; ix <= maxX; ix++) {
      for (var iy = minY; iy <= maxY; iy++) {
        var key = gridKey(ix, iy);
        if (!communeGridIndex.grid[key]) communeGridIndex.grid[key] = [];
        communeGridIndex.grid[key].push(code);
      }
    }
  });
}

function createEmptyCommuneStats() {
  return { od: 0, osm: 0, nat: 0, total: 0 };
}

function resetCommuneStats() {
  communeStatsByCode = {};
  if (!communesIVData) return;
  communesIVData.features.forEach(function(feature) {
    var code = getCommuneCode(feature);
    if (code) communeStatsByCode[code] = createEmptyCommuneStats();
  });
}

function getBBoxForFeature(feature) {
  feature = resolveCommuneFeature(feature);
  var code = getCommuneCode(feature);
  if (code && communeMetaByCode[code]) return communeMetaByCode[code].bb;
  return turf.bbox(feature);
}

function findCommuneCodeForPoint(feature) {
  if (!communeGridIndex) buildCommuneSpatialIndex();
  if (!communeGridIndex) return null;

  var c = feature.geometry.coordinates;
  var key = gridKey(gridCoord(c[0], communeGridIndex.cellSize), gridCoord(c[1], communeGridIndex.cellSize));
  var candidates = communeGridIndex.grid[key] || [];

  for (var i = 0; i < candidates.length; i++) {
    var code = candidates[i];
    var meta = communeMetaByCode[code];
    if (!meta) continue;
    var bb = meta.bb;
    if (c[0] < bb[0] || c[0] > bb[2] || c[1] < bb[1] || c[1] > bb[3]) continue;
    try {
      if (turf.booleanPointInPolygon(feature, meta.feature)) return code;
    } catch(e) {}
  }

  return null;
}

function updateMaxArbreCountFromStats() {
  maxArbreCount = 1;
  if (!communesRMData) return;
  communesRMData.features.forEach(function(feature) {
    var stats = communeStatsByCode[getCommuneCode(feature)];
    var total = stats ? stats.total : 0;
    if (total > maxArbreCount) maxArbreCount = total;
  });
}

function flushSpatialCacheCallbacks() {
  var callbacks = spatialCacheCallbacks.slice();
  spatialCacheCallbacks = [];
  callbacks.forEach(function(cb) {
    try { cb(); } catch(err) { console.error('spatial cache callback', err); }
  });
}

function invalidateSpatialCaches() {
  spatialCacheStatus = 'idle';
  featureGridIndexes = { od:null, osm:null, nat:null };
  maxArbreCount = 1;
  choroplethData = null;
}

function rebuildSpatialCaches(callback) {
  if (callback) spatialCacheCallbacks.push(callback);
  if (!communesIVData) {
    spatialCacheStatus = 'ready';
    flushSpatialCacheCallbacks();
    return;
  }

  spatialCacheStatus = 'building';
  var token = ++spatialCacheToken;

  buildCommuneSpatialIndex();
  resetCommuneStats();

  featureGridIndexes.od  = buildFeatureGridIndex(allFeaturesOpenData, FEATURE_GRID_SIZE);
  featureGridIndexes.osm = buildFeatureGridIndex(allFeaturesOSM, FEATURE_GRID_SIZE);
  featureGridIndexes.nat = buildFeatureGridIndex(allFeaturesNational, FEATURE_GRID_SIZE);

  function assignBatch(features, key, startIdx, chunkSize, done) {
    if (token !== spatialCacheToken) return;
    var end = Math.min(startIdx + chunkSize, features.length);

    for (var i = startIdx; i < end; i++) {
      var code = findCommuneCodeForPoint(features[i]);
      if (!code) continue;
      var stats = communeStatsByCode[code] || (communeStatsByCode[code] = createEmptyCommuneStats());
      stats[key]++;
      stats.total++;
    }

    if (token !== spatialCacheToken) return;

    if (end < features.length) {
      setTimeout(function() { assignBatch(features, key, end, chunkSize, done); }, 0);
    } else {
      done();
    }
  }

  var CHUNK = 500;
  assignBatch(allFeaturesOpenData, 'od', 0, CHUNK, function() {
    assignBatch(allFeaturesOSM, 'osm', 0, CHUNK, function() {
      assignBatch(allFeaturesNational, 'nat', 0, CHUNK, function() {
        if (token !== spatialCacheToken) return;
        updateMaxArbreCountFromStats();
        choroplethData = null;
        spatialCacheStatus = 'ready';
        flushSpatialCacheCallbacks();
      });
    });
  });
}

function ensureSpatialCaches(callback) {
  if (spatialCacheStatus === 'ready') {
    callback();
    return;
  }
  if (callback) spatialCacheCallbacks.push(callback);
  if (spatialCacheStatus !== 'building') rebuildSpatialCaches();
}

// ══════════════════════════════
// FLY TO
// ══════════════════════════════
function flyToCommune(feature) {
  var fullFeature = resolveCommuneFeature(feature);
  var bbox = getBBoxForFeature(fullFeature);

  if (bbox && bbox.length === 4 && isFinite(bbox[0]) && isFinite(bbox[1]) && isFinite(bbox[2]) && isFinite(bbox[3])) {
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top: 26, right: 26, bottom: 26, left: 26 },
      maxZoom: 14,
      duration: 900,
      essential: true
    });
    return;
  }

  var center = turf.center(fullFeature).geometry.coordinates;
  map.flyTo({
    center: center,
    zoom: 13,
    duration: 900,
    essential: true,
    easing: function(t){ return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; }
  });
}

// ══════════════════════════════
// KPI TOPBAR
// ══════════════════════════════
function updateKPIs() {
  animateCount(document.getElementById('kv-opendata'), allFeaturesOpenData.length, 800);
  animateCount(document.getElementById('kv-osm'),      allFeaturesOSM.length,      800);
  animateCount(document.getElementById('kv-national'), allFeaturesNational.length, 800);
  animateCount(document.getElementById('kv-total'),    allFeaturesOpenData.length + allFeaturesOSM.length + allFeaturesNational.length, 900);
}

// ══════════════════════════════
// UTILITAIRES ESSENCE
// ══════════════════════════════
// Valeurs d'essences à exclure (non informatives)
var ESSENCE_BLACKLIST = new Set([
  'inconnu','non renseigné','non renseignee','nr','nd','nc','divers',
  'autre','autres','indéterminé','indetermine','sans objet',
  'feuillu','conifère','conifere','arbre','arbres','sujet','plant',
  'sp','spp','indet','?','–','-','n/a','na','null','undefined'
]);

function getEssence(props, fields) {
  for (var i = 0; i < fields.length; i++) {
    var v = props[fields[i]];
    if (!v || typeof v !== 'string') continue;
    v = v.trim();
    if (!v || v.length < 3) continue;
    // Rejeter si c'est un nombre ou un code (ex: "1234", "ARB-001")
    if (/^\d+$/.test(v)) continue;
    if (/^[A-Z]{2,4}-?\d+$/i.test(v)) continue;
    var low = v.toLowerCase();
    if (ESSENCE_BLACKLIST.has(low)) continue;
    // Capitaliser proprement
    return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  }
  return null;
}

function getEssenceFieldsForFeature(feature) {
  var cat = feature && feature.properties ? feature.properties.categorie : '';
  if (cat === 'OpenData') return ESSENCE_FIELD_OD;
  if (cat === 'OSM') return ESSENCE_FIELD_OSM;
  return ESSENCE_FIELD_NAT;
}

function filterFeaturesByActiveEssence(features) {
  if (!essenceFilter || essenceFilter.size === 0) return features;
  return features.filter(function(feature) {
    var essence = getEssence(feature.properties, getEssenceFieldsForFeature(feature));
    return essence ? essenceFilter.has(essence) : false;
  });
}

function buildEssenceIndex() {
  essenceIndex = {};
  allFeaturesOpenData.forEach(function(f) {
    var e = getEssence(f.properties, ESSENCE_FIELD_OD);
    if (e) essenceIndex[e] = (essenceIndex[e] || 0) + 1;
  });
  allFeaturesOSM.forEach(function(f) {
    var e = getEssence(f.properties, ESSENCE_FIELD_OSM);
    if (e) essenceIndex[e] = (essenceIndex[e] || 0) + 1;
  });
  allFeaturesNational.forEach(function(f) {
    var e = getEssence(f.properties, ESSENCE_FIELD_NAT);
    if (e) essenceIndex[e] = (essenceIndex[e] || 0) + 1;
  });
  // Supprimer les essences avec moins de 5 arbres (bruit)
  Object.keys(essenceIndex).forEach(function(k) {
    if (essenceIndex[k] < 5) delete essenceIndex[k];
  });
}

// Applique les filtres actifs (essence + minTrees sur les communes)
// sur les layers MapLibre via setFilter
function applyFilters() {
  var essenceExpr = null;
  if (essenceFilter && essenceFilter.size > 0) {
    var arr = Array.from(essenceFilter);
    // Filtre "in" sur les champs possibles d'essence
    var odFields  = ESSENCE_FIELD_OD;
    var osmFields = ESSENCE_FIELD_OSM;
    var natFields = ESSENCE_FIELD_NAT;

    function buildEssenceLayerFilter(fields) {
      // ['any', ['in', ['downcase',['get','nom_commun']], ['literal',['chêne','érable',...]]], ...]
      var checks = [];
      fields.forEach(function(field) {
        arr.forEach(function(ess) {
          checks.push(['==', ['downcase', ['to-string', ['get', field]]], ess.toLowerCase()]);
        });
      });
      return checks.length > 0 ? ['any'].concat(checks) : null;
    }

    if (map.getLayer('arbres-layer')) {
      var f = buildEssenceLayerFilter(odFields);
      map.setFilter('arbres-layer', f);
    }
    if (map.getLayer('arbres-osm-layer')) {
      var f2 = buildEssenceLayerFilter(osmFields);
      map.setFilter('arbres-osm-layer', f2);
    }
    if (map.getLayer('arbres-national-layer')) {
      var f3 = buildEssenceLayerFilter(natFields);
      map.setFilter('arbres-national-layer', f3);
    }
  } else {
    // Pas de filtre essence → retirer les filtres
    if (map.getLayer('arbres-layer'))          map.setFilter('arbres-layer', null);
    if (map.getLayer('arbres-osm-layer'))      map.setFilter('arbres-osm-layer', null);
    if (map.getLayer('arbres-national-layer')) map.setFilter('arbres-national-layer', null);
  }

  // Remettre à jour l'UI
  renderDonutGlobal();
  if (currentCommune) showCommuneCard(currentCommune);
}

// Graphique top essences + sélection filtre
function renderEssenceChart() {
  buildEssenceIndex();

  // Top 15 essences
  var sorted = Object.entries(essenceIndex)
    .sort(function(a,b){return b[1]-a[1];})
    .slice(0, 15);

  if (!sorted.length) {
    document.getElementById('essence-empty').style.display = 'block';
    return;
  }
  document.getElementById('essence-empty').style.display = 'none';

  var labels = sorted.map(function(e){return e[0];});
  var values = sorted.map(function(e){return e[1];});
  var total  = values.reduce(function(a,b){return a+b;},0);
  var MAX_ESSENCE_LABEL = 20;

  function compactEssenceLabel(label) {
    if (!label || label.length <= MAX_ESSENCE_LABEL) return label;
    return label.slice(0, MAX_ESSENCE_LABEL - 1) + '…';
  }

  // Couleurs dégradées de vert forêt
  var palette = labels.map(function(_,i) {
    var h = 120 + (i * 8) % 60;
    var s = 55 - i * 1.5;
    var l = 55 - i * 1.2;
    return 'hsl('+h+','+s+'%,'+l+'%)';
  });

  if (chartEssence) { chartEssence.destroy(); chartEssence = null; }

  var wrap = document.getElementById('essence-chart-wrap');
  wrap.style.height = Math.max(220, sorted.length * 22 + 40) + 'px';

  chartEssence = new Chart(document.getElementById('cvs-essence'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: palette,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: {
        padding: { left: 8, right: 4 }
      },
      onClick: function(evt, elements) {
        if (!elements.length) return;
        var idx = elements[0].index;
        var ess = labels[idx];
        toggleEssenceFilter(ess);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function(items) {
              return items && items.length ? labels[items[0].dataIndex] : '';
            },
            label: function(ctx) {
              var pct = total > 0 ? Math.round(ctx.raw/total*100) : 0;
              return ' '+fmt(ctx.raw)+' ('+pct+'%)';
            }
          },
          backgroundColor: 'rgba(8,13,10,0.96)',
          titleColor: '#dff0e4', bodyColor: '#dff0e4',
          borderColor: 'rgba(61,214,140,0.2)', borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(61,214,140,0.06)' },
          ticks: { color: 'rgba(200,230,210,0.35)', font: { size: 10 },
            callback: function(v){ return v>=1000?Math.round(v/1000)+'k':v; } }
        },
        y: {
          grid: { display: false },
          afterFit: function(scale) {
            scale.width = Math.max(scale.width + 12, 112);
          },
          ticks: {
            padding: 6,
            callback: function(value, index) {
              return compactEssenceLabel(labels[index]);
            },
            color: function(ctx) {
              var ess = labels[ctx.index];
              return (essenceFilter && essenceFilter.has(ess)) ? '#3dd68c' : 'rgba(200,230,210,0.6)';
            },
            font: { size: 10.5 }
          }
        }
      }
    }
  });

  // Mettre à jour le badge de filtre actif
  updateEssenceBadge();
}

function toggleEssenceFilter(ess) {
  if (!essenceFilter) essenceFilter = new Set();
  if (essenceFilter.has(ess)) {
    essenceFilter.delete(ess);
    if (essenceFilter.size === 0) essenceFilter = null;
  } else {
    essenceFilter.add(ess);
  }
  applyFilters();
  renderEssenceChart(); // re-render pour colorer la barre sélectionnée
}

function clearEssenceFilter() {
  essenceFilter = null;
  applyFilters();
  renderEssenceChart();
}

function updateEssenceBadge() {
  var badge = document.getElementById('essence-filter-badge');
  var clearBtn = document.getElementById('essence-clear-btn');
  if (essenceFilter && essenceFilter.size > 0) {
    badge.textContent = essenceFilter.size + ' sélectionnée'+(essenceFilter.size>1?'s':'');
    badge.style.display = 'inline-flex';
    clearBtn.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
    clearBtn.style.display = 'none';
  }
}

// ══════════════════════════════
// SCORE DE FIABILITÉ
// Composantes (total 100 pts) :
//   25 pts – taux de renseignement de l'essence
//   15 pts – taux de renseignement de la hauteur
//   20 pts – qualité attributaire globale (arbres sans anomalie favorisés)
//   30 pts – confiance accordée aux sources présentes
//   10 pts – diversité des sources (faible bonus, pas un moteur principal)
// ══════════════════════════════
var FIABILITE_FIELDS_OD  = { essence: ['nom_commun','libelle_fr','genre_lati'], hauteur: ['hauteur'] };
var FIABILITE_FIELDS_OSM = { essence: ['species','genus'], hauteur: ['height'] };
var FIABILITE_FIELDS_NAT = { essence: ['nom_commun','essence','libelle_fr','genre_francais'], hauteur: ['hauteur'] };
var FIABILITE_SOURCE_WEIGHTS = { OpenData: 1, National: 0.85, OSM: 0.55 };

function hasVal(props, fields) {
  for (var i = 0; i < fields.length; i++) {
    var v = props[fields[i]];
    if (v && typeof v === 'string' && v.trim().length > 1 &&
        v.toLowerCase() !== 'null' && v.toLowerCase() !== 'nd' && v !== '-') return true;
    if (v && typeof v === 'number' && v > 0) return true;
  }
  return false;
}

function getQualityFieldsForFeature(feature) {
  var cat = feature && feature.properties ? feature.properties.categorie : '';
  if (cat === 'OpenData') return FIABILITE_FIELDS_OD;
  if (cat === 'OSM') return FIABILITE_FIELDS_OSM;
  return FIABILITE_FIELDS_NAT;
}

function getQualityAnomalyMeta(feature) {
  var fields = getQualityFieldsForFeature(feature);
  var missingEssence = !hasVal(feature.properties, fields.essence);
  var missingHeight  = !hasVal(feature.properties, fields.hauteur);

  if (!missingEssence && !missingHeight) return null;

  if (missingEssence && missingHeight) {
    return { type: 'both' };
  }
  if (missingEssence) {
    return { type: 'essence' };
  }
  return { type: 'height' };
}

function updateQualityPanel() {
  var totalEl   = document.getElementById('qa-total');
  var essenceEl = document.getElementById('qa-essence');
  var heightEl  = document.getElementById('qa-height');
  var bothEl    = document.getElementById('qa-both');
  var summaryEl = document.getElementById('quality-summary');
  if (!totalEl || !essenceEl || !heightEl || !bothEl || !summaryEl) return;

  totalEl.textContent   = fmt(qualityAnomalyStats.total);
  essenceEl.textContent = fmt(qualityAnomalyStats.missingEssence);
  heightEl.textContent  = fmt(qualityAnomalyStats.missingHeight);
  bothEl.textContent    = fmt(qualityAnomalyStats.missingBoth);

  if (!qualityAnomalyStats.totalTrees) {
    summaryEl.textContent = 'Aucune donnée chargée.';
    return;
  }

  var pct = Math.round(qualityAnomalyStats.total / qualityAnomalyStats.totalTrees * 100);
  summaryEl.innerHTML = '<strong>' + fmt(qualityAnomalyStats.total) + '</strong> arbres présentent au moins une anomalie, soit ' + pct + '% des données chargées.';
}

function rebuildQualityAnomalies() {
  qualityAnomalyStats = {
    total: 0,
    missingEssence: 0,
    missingHeight: 0,
    missingBoth: 0,
    totalTrees: allFeaturesOpenData.length + allFeaturesOSM.length + allFeaturesNational.length
  };

  function collect(features) {
    features.forEach(function(feature) {
      var anomaly = getQualityAnomalyMeta(feature);
      if (!anomaly) return;

      qualityAnomalyStats.total++;
      if (anomaly.type === 'both') qualityAnomalyStats.missingBoth++;
      if (anomaly.type === 'essence' || anomaly.type === 'both') qualityAnomalyStats.missingEssence++;
      if (anomaly.type === 'height' || anomaly.type === 'both') qualityAnomalyStats.missingHeight++;
    });
  }

  collect(allFeaturesOpenData);
  collect(allFeaturesOSM);
  collect(allFeaturesNational);

  updateQualityPanel();
}

function computeFiabiliteScore(arbresInCommune) {
  var od  = arbresInCommune.filter(function(f){ return f.properties.categorie === 'OpenData'; });
  var osm = arbresInCommune.filter(function(f){ return f.properties.categorie === 'OSM'; });
  var nat = arbresInCommune.filter(function(f){ return f.properties.categorie === 'National'; });
  var sources = (od.length > 0 ? 1 : 0) + (osm.length > 0 ? 1 : 0) + (nat.length > 0 ? 1 : 0);

  // 25 pts essence
  var essTotal = od.length + osm.length + nat.length;
  var essRens = 0;
  od.forEach(function(f){ if(hasVal(f.properties, FIABILITE_FIELDS_OD.essence)) essRens++; });
  osm.forEach(function(f){ if(hasVal(f.properties, FIABILITE_FIELDS_OSM.essence)) essRens++; });
  nat.forEach(function(f){ if(hasVal(f.properties, FIABILITE_FIELDS_NAT.essence)) essRens++; });
  var essPct = essTotal > 0 ? Math.round(essRens / essTotal * 100) : 0;
  var scoreEssence = essTotal > 0 ? Math.round((essRens / essTotal) * 25) : 0;

  // 15 pts hauteur
  var htTotal = od.length + osm.length + nat.length;
  var htRens = 0;
  od.forEach(function(f){ if(hasVal(f.properties, FIABILITE_FIELDS_OD.hauteur)) htRens++; });
  osm.forEach(function(f){ if(hasVal(f.properties, FIABILITE_FIELDS_OSM.hauteur)) htRens++; });
  nat.forEach(function(f){ if(hasVal(f.properties, FIABILITE_FIELDS_NAT.hauteur)) htRens++; });
  var htPct = htTotal > 0 ? Math.round(htRens / htTotal * 100) : 0;
  var scoreHauteur = htTotal > 0 ? Math.round((htRens / htTotal) * 15) : 0;

  // 20 pts qualité attributaire globale
  var qualityUnits = 0;
  arbresInCommune.forEach(function(f) {
    var anomaly = getQualityAnomalyMeta(f);
    if (!anomaly) {
      qualityUnits += 1;
    } else if (anomaly.type !== 'both') {
      qualityUnits += 0.5;
    }
  });
  var qualityPct = arbresInCommune.length > 0 ? Math.round(qualityUnits / arbresInCommune.length * 100) : 0;
  var scoreQualite = arbresInCommune.length > 0 ? Math.round((qualityUnits / arbresInCommune.length) * 20) : 0;

  // 30 pts confiance source
  var sourceUnits = 0;
  arbresInCommune.forEach(function(f) {
    var cat = f && f.properties ? f.properties.categorie : '';
    sourceUnits += FIABILITE_SOURCE_WEIGHTS[cat] || 0;
  });
  var sourceConfidencePct = arbresInCommune.length > 0 ? Math.round(sourceUnits / arbresInCommune.length * 100) : 0;
  var scoreSources = arbresInCommune.length > 0 ? Math.round((sourceUnits / arbresInCommune.length) * 30) : 0;

  // 10 pts diversité des sources
  var scoreDiversite = sources >= 3 ? 10 : (sources === 2 ? 6 : 0);

  var total = Math.min(100, scoreEssence + scoreHauteur + scoreQualite + scoreSources + scoreDiversite);

  return {
    total: total,
    sources: sources,
    essPct: essPct,
    essTotal: essTotal, essRens: essRens,
    htPct: htPct,
    htTotal: htTotal, htRens: htRens,
    scoreEssence: scoreEssence,
    scoreHauteur: scoreHauteur,
    qualityPct: qualityPct,
    sourceConfidencePct: sourceConfidencePct,
    scoreQualite: scoreQualite,
    scoreSources: scoreSources,
    scoreDiversite: scoreDiversite,
    nbOD: od.length, nbOSM: osm.length, nbNat: nat.length
  };
}

function renderFiabilite(score) {
  var badge = document.getElementById('fiabilite-badge');
  var bar   = document.getElementById('fiabilite-bar');
  var detail= document.getElementById('fiabilite-detail');
  if (!badge) return;

  badge.textContent = score.total + '/100';
  var color = score.total >= 70 ? '#3dd68c' : score.total >= 40 ? '#fbbf24' : '#f87171';
  badge.style.color = color;

  setTimeout(function(){ bar.style.width = score.total + '%'; bar.style.background = color; }, 100);

  detail.innerHTML =
    score.sources + ' source(s) présente(s) · Confiance : ' + score.sourceConfidencePct + '%<br>' +
    'Qualité : ' + score.qualityPct + '% · Essence : ' + score.essPct + '% · Hauteur : ' + score.htPct + '%';
}

// ══════════════════════════════
// COMPLÉTUDE ATTRIBUTAIRE
// ══════════════════════════════
var chartCompletudeAttr = null;

function computeCompletude(features, essFields, htFields) {
  if (!features.length) return { essence: 0, hauteur: 0, n: 0 };
  var essRens = 0, htRens = 0;
  features.forEach(function(f) {
    if (hasVal(f.properties, essFields)) essRens++;
    if (hasVal(f.properties, htFields))  htRens++;
  });
  return {
    essence: Math.round(essRens / features.length * 100),
    hauteur: Math.round(htRens  / features.length * 100),
    n: features.length
  };
}

function renderCompletudeAttr() {
  var odC  = computeCompletude(allFeaturesOpenData,  FIABILITE_FIELDS_OD.essence,  FIABILITE_FIELDS_OD.hauteur);
  var osmC = computeCompletude(allFeaturesOSM,        FIABILITE_FIELDS_OSM.essence, FIABILITE_FIELDS_OSM.hauteur);
  var natC = computeCompletude(allFeaturesNational,   FIABILITE_FIELDS_NAT.essence, FIABILITE_FIELDS_NAT.hauteur);

  var labels = [];
  var dataEss = [], dataHt = [], colorsMain = [], colorsSec = [];

  if (allFeaturesOpenData.length > 0) {
    labels.push('OpenData'); dataEss.push(odC.essence); dataHt.push(odC.hauteur);
    colorsMain.push('rgba(61,214,140,0.75)'); colorsSec.push('rgba(61,214,140,0.3)');
  }
  if (allFeaturesOSM.length > 0) {
    labels.push('OSM');      dataEss.push(osmC.essence); dataHt.push(osmC.hauteur);
    colorsMain.push('rgba(96,165,250,0.75)'); colorsSec.push('rgba(96,165,250,0.3)');
  }
  if (allFeaturesNational.length > 0) {
    labels.push('National'); dataEss.push(natC.essence); dataHt.push(natC.hauteur);
    colorsMain.push('rgba(244,114,182,0.75)'); colorsSec.push('rgba(244,114,182,0.3)');
  }

  if (!labels.length) return;

  if (chartCompletudeAttr) { chartCompletudeAttr.destroy(); chartCompletudeAttr = null; }

  chartCompletudeAttr = new Chart(document.getElementById('cvs-completude-attr'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: 'Essence', data: dataEss, backgroundColor: colorsMain, borderRadius: 4, borderSkipped: false },
        { label: 'Hauteur', data: dataHt,  backgroundColor: colorsSec,  borderRadius: 4, borderSkipped: false,
          borderWidth: 1, borderColor: colorsMain }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: function(ctx){ return ' '+ctx.dataset.label+' : '+ctx.raw+'%'; } },
          backgroundColor: 'rgba(8,13,10,0.96)', titleColor: '#dff0e4', bodyColor: '#dff0e4',
          borderColor: 'rgba(61,214,140,0.2)', borderWidth: 1
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: 'rgba(200,230,210,0.6)', font: { size: 11 } } },
        y: {
          min: 0, max: 100,
          grid: { color: 'rgba(61,214,140,0.06)' },
          ticks: { color: 'rgba(200,230,210,0.35)', font: { size: 10 },
            callback: function(v){ return v + '%'; } }
        }
      }
    }
  });

  document.getElementById('completude-attr-legend').innerHTML =
    '<span class="legend-item"><span class="legend-swatch" style="background:rgba(200,230,210,0.7)"></span>Barre pleine = Essence · Barre claire = Hauteur</span>';
}

// ══════════════════════════════
// GRAPHIQUE RÉPARTITION GLOBALE
// ══════════════════════════════
function renderDonutGlobal() {
  var odOn  = document.getElementById('opendata-check').checked;
  var osmOn = document.getElementById('osm-check').checked;
  var natEl = document.getElementById('national-check');
  var natOn = natEl ? natEl.checked : false;

  var odCount  = filterFeaturesByActiveEssence(allFeaturesOpenData).length;
  var osmCount = filterFeaturesByActiveEssence(allFeaturesOSM).length;
  var natCount = filterFeaturesByActiveEssence(allFeaturesNational).length;

  var labels=[], data=[], colors=[];
  if (odOn  && odCount  > 0) { labels.push('OpenData'); data.push(odCount);  colors.push('#4ade80'); }
  if (osmOn && osmCount > 0) { labels.push('OSM');      data.push(osmCount); colors.push('#60a5fa'); }
  if (natOn && natCount > 0) { labels.push('National'); data.push(natCount); colors.push('#f472b6'); }

  if (chartDonutGlobal) { chartDonutGlobal.destroy(); chartDonutGlobal = null; }
  if (!data.length) return;

  chartDonutGlobal = new Chart(document.getElementById('cvs-donut-global'), {
    type:'doughnut',
    data:{ labels:labels, datasets:[{ data:data, backgroundColor:colors, borderColor:'#111520', borderWidth:3, hoverOffset:5 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'70%',
      plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label:function(ctx){ var t=ctx.dataset.data.reduce(function(a,b){return a+b;},0); return ' '+fmt(ctx.raw)+' ('+(t>0?Math.round(ctx.raw/t*100):0)+'%)'; } },
          backgroundColor:'rgba(11,14,20,0.95)', titleColor:'#e2e8f0', bodyColor:'#e2e8f0', borderColor:'rgba(255,255,255,0.1)', borderWidth:1 }
      }
    }
  });
  var totalAll = data.reduce(function(a,b){return a+b;},0);
  document.getElementById('donut-global-legend').innerHTML = labels.map(function(l,i){
    var pct = totalAll>0 ? Math.round(data[i]/totalAll*100) : 0;
    return '<span class="legend-item"><span class="legend-swatch" style="background:'+colors[i]+'"></span>'+l+' <strong style="color:#e2e8f0">'+pct+'%</strong></span>';
  }).join('');
}

// ══════════════════════════════
// COMMUNE CARD
// ══════════════════════════════
function statRow(color, label, value) {
  return '<div class="stat-row"><span class="stat-label"><span class="stat-dot" style="background:'+color+'"></span>'+label+'</span>'
       + '<span class="stat-value stat-anim" data-target="'+value+'">0</span></div>';
}

function filterFeaturesInPolygon(sourceKey, polygonFeature) {
  var fullPolygonFeature = resolveCommuneFeature(polygonFeature);
  var bbox = getBBoxForFeature(fullPolygonFeature);
  var index = featureGridIndexes[sourceKey];
  var candidates = index ? queryFeatureGrid(index, bbox) : getFeaturesForSourceKey(sourceKey);
  return candidates.filter(function(f) {
    try { return turf.booleanPointInPolygon(f, fullPolygonFeature); } catch(e) { return false; }
  });
}

// Filtre rapide : grille spatiale + bbox + pip précis
function filterInCommune(sourceKey, communeFeature) {
  return filterFeaturesInPolygon(sourceKey, communeFeature);
}

function showCommuneCard(feature) {
  feature = resolveCommuneFeature(feature);
  var props  = feature.properties;
  var odOn   = document.getElementById('opendata-check').checked;
  var osmOn  = document.getElementById('osm-check').checked;
  var natEl  = document.getElementById('national-check');
  var natOn  = natEl ? natEl.checked : false;

  // Afficher la card immédiatement avec un état de chargement
  document.getElementById('commune-card-name').textContent = props.nom;
  document.getElementById('commune-card-sub').textContent  = props.codeDepartement ? 'Dépt. '+props.codeDepartement : 'Ille-et-Vilaine';
  var noteEl = document.getElementById('commune-card-note');
  if (noteEl) {
    var charterStatus = getCommuneTreeCharterStatus(feature);
    noteEl.textContent = charterStatus.note;
    noteEl.classList.toggle('is-signed', charterStatus.signed);
    noteEl.classList.toggle('is-unsigned', !charterStatus.signed);
    noteEl.style.display = 'block';
  }
  document.getElementById('commune-stats').innerHTML = '<div style="color:rgba(200,230,210,.3);font-size:11px;padding:4px 0">Calcul en cours…</div>';
  document.getElementById('fiabilite-badge').textContent = '…';
  document.getElementById('fiabilite-bar').style.width = '0%';
  document.getElementById('fiabilite-detail').textContent = '';

  var card = document.getElementById('commune-card');
  card.style.display = 'block'; card.style.animation = 'none';
  requestAnimationFrame(function(){ card.style.animation=''; });

  // Calcul différé — libère le thread pour l'animation de la card
  setTimeout(function() {
    // UNE SEULE passe par source — grille spatiale + bbox + pip précis
    var arbresOD  = odOn  ? filterFeaturesByActiveEssence(filterInCommune('od',  feature)) : [];
    var arbresOSM = osmOn ? filterFeaturesByActiveEssence(filterInCommune('osm', feature)) : [];
    var arbresNat = natOn ? filterFeaturesByActiveEssence(filterInCommune('nat', feature)) : [];
    var nOD  = arbresOD.length, nOSM = arbresOSM.length, nNat = arbresNat.length;
    var total = nOD + nOSM + nNat;

    // Statistiques
    var rows = '';
    if (odOn)  rows += statRow('#4ade80','OpenData', nOD);
    if (osmOn) rows += statRow('#60a5fa','OSM',      nOSM);
    if (natOn) rows += statRow('#f472b6','National', nNat);
    rows += '<div class="stat-row" style="margin-top:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">'
         + '<span class="stat-label" style="font-weight:600;color:rgba(255,255,255,.6)">Total</span>'
         + '<span class="stat-value" id="stat-total" style="font-size:20px">0</span></div>';
    document.getElementById('commune-stats').innerHTML = rows;

    setTimeout(function(){
      document.querySelectorAll('.stat-anim').forEach(function(el){ animateCount(el, parseInt(el.dataset.target)); });
      var te = document.getElementById('stat-total'); if(te) animateCount(te, total);
    }, 50);

    var densityReady = spatialCacheStatus === 'ready' && maxArbreCount > 0;
    var pct = densityReady ? Math.min(100, Math.round(total/maxArbreCount*100)) : 0;
    setTimeout(function(){ document.getElementById('commune-density-fill').style.width = pct+'%'; }, 100);
    document.getElementById('commune-density-label').textContent =
      densityReady ? pct+'% du maximum de la zone' : 'Indice de densité en préparation…';

    // Score de fiabilité — réutilise les arbres déjà filtrés (zéro calcul supplémentaire)
    var arbresInCommune = arbresOD.concat(arbresOSM).concat(arbresNat);
    var fiab = computeFiabiliteScore(arbresInCommune);
    renderFiabilite(fiab);

    updateCommuneChart(props.nom, nOD, nOSM, nNat, odOn, osmOn, natOn, pct, densityReady);
  }, 20);
}

function updateCommuneChart(nom, nOD, nOSM, nNat, odOn, osmOn, natOn, pct, densityReady) {
  document.getElementById('commune-chart-section').style.display = 'block';
  setPanelSectionExpanded('commune-chart-section', true);
  document.getElementById('commune-chart-name').textContent = nom;

  var labels=[], data=[], colors=[];
  if (odOn  && nOD  > 0) { labels.push('OpenData'); data.push(nOD);  colors.push('#4ade80'); }
  if (osmOn && nOSM > 0) { labels.push('OSM');      data.push(nOSM); colors.push('#60a5fa'); }
  if (natOn && nNat > 0) { labels.push('National'); data.push(nNat); colors.push('#f472b6'); }

  if (chartCommuneDonut) { chartCommuneDonut.destroy(); chartCommuneDonut=null; }

  if (!data.length) {
    document.getElementById('commune-donut-legend').innerHTML = '<span style="color:rgba(255,255,255,.3);font-size:11px">Aucune donnée.</span>';
  } else {
    chartCommuneDonut = new Chart(document.getElementById('cvs-commune-donut'), {
      type:'doughnut',
      data:{ labels:labels, datasets:[{data:data, backgroundColor:colors, borderColor:'#111520', borderWidth:3, hoverOffset:5}] },
      options:{ responsive:true, maintainAspectRatio:false, cutout:'65%',
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:function(ctx){return ' '+fmt(ctx.raw);}},
          backgroundColor:'rgba(11,14,20,0.95)', titleColor:'#e2e8f0', bodyColor:'#e2e8f0', borderColor:'rgba(255,255,255,0.1)', borderWidth:1 }
        }
      }
    });
    var tv = data.reduce(function(a,b){return a+b;},0);
    document.getElementById('commune-donut-legend').innerHTML = labels.map(function(l,i){
      var p = tv>0 ? Math.round(data[i]/tv*100) : 0;
      return '<span class="legend-item"><span class="legend-swatch" style="background:'+colors[i]+'"></span>'+l+' <strong style="color:#e2e8f0">'+p+'%</strong></span>';
    }).join('');
  }
  setTimeout(function(){ document.getElementById('commune-density-fill2').style.width = pct+'%'; }, 100);
  document.getElementById('commune-density-label2').textContent =
    densityReady ? pct+'% du max. zone' : 'Indice de densité en préparation…';
}

function closeCommuneCard() {
  document.getElementById('commune-card').style.display = 'none';
  document.getElementById('commune-chart-section').style.display = 'none';
  if (selectedId !== null) { try{ map.setFeatureState({source:'communes-iv',id:selectedId},{selected:false}); }catch(e){} }
  selectedId = null; currentCommune = null;
}

// ══════════════════════════════
// SÉLECTEUR FOND DE CARTE
// OSM et ortho sont des overlays raster ajoutés une fois au load.
// switchBasemap change juste leur visibilité.
// ══════════════════════════════
function initBasemapOverlays() {
  // Insérer les overlays AVANT le premier layer de données (cadastre)
  // Pour cela on utilise firstDataLayerId défini juste après cet appel
  ['osm', 'ortho'].forEach(function(name) {
    map.addSource('overlay-' + name, OVERLAY_SOURCES[name]);
    map.addLayer({
      id: 'overlay-layer-' + name,
      type: 'raster',
      source: 'overlay-' + name,
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 1 }
    }, firstDataLayerId); // inséré sous toutes les données
  });
}

function switchBasemap(name) {
  if (name === currentBasemap) return;
  currentBasemap = name;

  // OSM overlay
  if (map.getLayer('overlay-layer-osm'))
    map.setLayoutProperty('overlay-layer-osm', 'visibility', name === 'osm' ? 'visible' : 'none');
  // Ortho overlay
  if (map.getLayer('overlay-layer-ortho'))
    map.setLayoutProperty('overlay-layer-ortho', 'visibility', name === 'ortho' ? 'visible' : 'none');
  // dark = fond CartoDB de base, toujours là → rien à faire quand name === 'dark'

  document.querySelectorAll('.bm-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.style === name);
  });
}

// ══════════════════════════════
// OUTIL DE DESSIN
// ══════════════════════════════
function clearPolygon() {
  ['draw-polygon-fill','draw-polygon-outline'].forEach(function(l){ if(map.getLayer(l)) map.removeLayer(l); });
  if (map.getSource('draw-polygon')) map.removeSource('draw-polygon');
}
function clearPreview() {
  if (map.getLayer('draw-preview'))  map.removeLayer('draw-preview');
  if (map.getSource('draw-preview')) map.removeSource('draw-preview');
}
function updatePreview(lngLat) {
  if (!drawPoints.length) return;
  var coords = drawPoints.concat([[lngLat.lng, lngLat.lat], drawPoints[0]]);
  var data = { type:'Feature', geometry:{ type:'LineString', coordinates:coords } };
  if (map.getSource('draw-preview')) { map.getSource('draw-preview').setData(data); }
  else {
    map.addSource('draw-preview', { type:'geojson', data:data });
    map.addLayer({ id:'draw-preview', type:'line', source:'draw-preview',
      paint:{ 'line-color':'#4ade80', 'line-width':2, 'line-dasharray':[4,3] } });
  }
}
function startDraw() {
  drawMode=true; drawPoints=[];
  drawMarkers.forEach(function(m){m.remove();}); drawMarkers=[];
  clearPolygon();
  document.getElementById('selection-count').textContent = 'Cliquez pour placer des points…';
  var btn = document.getElementById('btn-draw');
  btn.classList.add('active');
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Terminer';
  map.getCanvas().style.cursor = 'crosshair';
}
function cancelDraw() {
  drawMode=false; drawPoints=[];
  drawMarkers.forEach(function(m){m.remove();}); drawMarkers=[];
  clearPreview();
  var btn = document.getElementById('btn-draw');
  btn.classList.remove('active');
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> Dessiner une zone';
  map.getCanvas().style.cursor = '';
}
function stopDraw() {
  if (drawPoints.length < 3) { toast('Minimum 3 points requis.','#ef4444'); cancelDraw(); return; }
  finishPolygon();
}
function finishPolygon() {
  drawMode=false; clearPreview(); map.getCanvas().style.cursor='';
  var btn = document.getElementById('btn-draw');
  btn.classList.remove('active');
  btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> Dessiner une zone';

  var coords = drawPoints.concat([drawPoints[0]]);
  var pgj = { type:'Feature', geometry:{ type:'Polygon', coordinates:[coords] } };
  if (map.getSource('draw-polygon')) { map.getSource('draw-polygon').setData(pgj); }
  else {
    map.addSource('draw-polygon',{type:'geojson',data:pgj});
    map.addLayer({id:'draw-polygon-fill',type:'fill',source:'draw-polygon',paint:{'fill-color':'#4ade80','fill-opacity':0.08}});
    map.addLayer({id:'draw-polygon-outline',type:'line',source:'draw-polygon',paint:{'line-color':'#4ade80','line-width':2}});
  }
  drawPoints=[]; drawMarkers.forEach(function(m){m.remove();}); drawMarkers=[];
  ['arbres-layer','arbres-osm-layer','arbres-national-layer'].forEach(function(l){if(map.getLayer(l))map.moveLayer(l);});

  var odOn  = document.getElementById('opendata-check').checked;
  var osmOn = document.getElementById('osm-check').checked;
  var natEl = document.getElementById('national-check'); var natOn = natEl?natEl.checked:false;
  var inOD  = odOn  ? filterFeaturesInPolygon('od',  pgj) : [];
  var inOSM = osmOn ? filterFeaturesInPolygon('osm', pgj) : [];
  var inNat = natOn ? filterFeaturesInPolygon('nat', pgj) : [];
  var total = inOD.length+inOSM.length+inNat.length;

  document.getElementById('selection-count').innerHTML =
    '<strong>'+fmt(total)+'</strong> arbres dans la zone' +
    '<br><span style="color:rgba(255,255,255,.3);font-size:11px">' +
    (odOn?'OpenData '+fmt(inOD.length)+' ':'')+
    (osmOn?'· OSM '+fmt(inOSM.length)+' ':'')+
    (natOn?'· Nat. '+fmt(inNat.length):'')+'</span>';

  // Stocker la sélection et afficher les boutons export
  lastSelectionFeatures = inOD.concat(inOSM).concat(inNat);
  var exportBtns = document.getElementById('export-btns');
  if (exportBtns) exportBtns.style.display = total > 0 ? 'flex' : 'none';
}

// ══════════════════════════════
// CHOROPLÈTHE – COUVERTURE OPEN DATA
// Calcul optimisé : index bbox par commune, puis affectation
// arbre→commune (pas commune→arbres), en chunks async.
// ══════════════════════════════
var choroplethActive  = false;
var choroplethData    = null;

var CHORO_COLORS = {
  0: '#334155',  // aucune
  1: '#3b82f6',  // OSM seul
  2: '#22c55e',  // OpenData seul
  3: '#f59e0b',  // National seul
  4: '#06b6d4',  // OpenData + OSM
  5: '#a3e635',  // OpenData + National
  6: '#8b5cf6',  // OSM + National
  7: '#f43f5e'   // 3 sources
};

function computeChoroplethFast(callback) {
  if (!communesIVData) { callback(); return; }
  ensureSpatialCaches(function() {
    var presence = {};

    communesIVData.features.forEach(function(c) {
      var code = getCommuneCode(c);
      var stats = communeStatsByCode[code] || createEmptyCommuneStats();
      var p = { od: stats.od > 0, osm: stats.osm > 0, nat: stats.nat > 0 };
      var n;

      if      (p.od && p.osm && p.nat) n = 7;
      else if (p.od && p.nat)          n = 5;
      else if (p.osm && p.nat)         n = 6;
      else if (p.od && p.osm)          n = 4;
      else if (p.od)                   n = 2;
      else if (p.osm)                  n = 1;
      else if (p.nat)                  n = 3;
      else                             n = 0;

      presence[code] = p;
      c.properties._choro = n;
    });

    choroplethData = presence;
    callback();
  });
}

function applyChoropleth() {
  if (!communesIVData || !choroplethData) return;

  // Mettre à jour les données source avec le champ _choro
  map.getSource('communes-iv').setData(communesIVData);

  // Expression de couleur par étape
  var colorExpr = ['match', ['get', '_choro'],
    0, CHORO_COLORS[0],
    1, CHORO_COLORS[1],
    2, CHORO_COLORS[2],
    3, CHORO_COLORS[3],
    4, CHORO_COLORS[4],
    5, CHORO_COLORS[5],
    6, CHORO_COLORS[6],
    7, CHORO_COLORS[7],
    '#1f2937'
  ];

  map.setPaintProperty('communes-iv-fill', 'fill-color', [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    'rgba(167,139,250,0.25)',
    colorExpr
  ]);
  map.setPaintProperty('communes-iv-fill', 'fill-opacity', 0.75);
  map.setPaintProperty('communes-iv-line', 'line-color', 'rgba(255,255,255,0.2)');
  map.setPaintProperty('communes-iv-line', 'line-width', 0.4);
}

function resetChoropleth() {
  map.setPaintProperty('communes-iv-fill', 'fill-color', [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    'rgba(167,139,250,0.12)',
    'rgba(255,255,255,0.01)'
  ]);
  map.setPaintProperty('communes-iv-fill', 'fill-opacity', 1);
  map.setPaintProperty('communes-iv-line', 'line-color', [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    '#a78bfa', 'rgba(255,255,255,0.12)'
  ]);
  map.setPaintProperty('communes-iv-line', 'line-width', [
    'case', ['boolean', ['feature-state', 'selected'], false], 1.5, 0.5
  ]);
}

function toggleChoropleth(on) {
  choroplethActive = on;
  document.getElementById('choropleth-legend').style.display = on ? 'block' : 'none';

  if (on) {
    if (!choroplethData) {
      toast('Calcul couverture en cours…', '#a78bfa');
      setLoading(true);
      computeChoroplethFast(function() {
        setLoading(false);
        applyChoropleth();
        toast('Couverture OpenData calculée ✓', '#3dd68c');
      });
    } else {
      applyChoropleth();
    }
  } else {
    resetChoropleth();
  }
}

// ══════════════════════════════
// EXPORT CSV / GEOJSON
// ══════════════════════════════
var lastSelectionFeatures = null;

function downloadFile(content, filename, mime) {
  var blob = new Blob([content], { type: mime });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCSV(features) {
  if (!features || !features.length) { toast('Aucun arbre à exporter.', '#ef4444'); return; }

  // Collecter toutes les clés présentes
  var keys = new Set(['source','longitude','latitude']);
  features.forEach(function(f) {
    Object.keys(f.properties).forEach(function(k) {
      if (k !== 'geo_point_2d' && k !== 'categorie') keys.add(k);
    });
  });
  keys = Array.from(keys);

  var rows = [keys.join(';')];
  features.forEach(function(f) {
    var coords = f.geometry.coordinates;
    var row = keys.map(function(k) {
      if (k === 'longitude') return coords[0].toFixed(6);
      if (k === 'latitude')  return coords[1].toFixed(6);
      if (k === 'source')    return f.properties.categorie || '';
      var v = f.properties[k];
      if (v === null || v === undefined) return '';
      v = String(v).replace(/"/g, '""');
      return v.includes(';') || v.includes('\n') ? '"'+v+'"' : v;
    });
    rows.push(row.join(';'));
  });

  var ts = new Date().toISOString().slice(0,10);
  downloadFile(rows.join('\n'), 'arbres_selection_'+ts+'.csv', 'text/csv;charset=utf-8;');
  toast(fmt(features.length)+' arbres exportés en CSV', '#3dd68c');
}

function exportGeoJSON(features) {
  if (!features || !features.length) { toast('Aucun arbre à exporter.', '#ef4444'); return; }

  var fc = {
    type: 'FeatureCollection',
    features: features.map(function(f) {
      var props = {};
      Object.keys(f.properties).forEach(function(k) {
        if (k !== 'geo_point_2d') props[k] = f.properties[k];
      });
      return { type:'Feature', geometry: f.geometry, properties: props };
    })
  };

  var ts = new Date().toISOString().slice(0,10);
  downloadFile(JSON.stringify(fc, null, 2), 'arbres_selection_'+ts+'.geojson', 'application/geo+json');
  toast(fmt(features.length)+' arbres exportés en GeoJSON', '#3dd68c');
}

function getCoverageClassFromStats(stats) {
  var hasOD = stats.od > 0;
  var hasOSM = stats.osm > 0;
  var hasNat = stats.nat > 0;

  if (hasOD && hasOSM && hasNat) return '3 sources';
  if (hasOD && hasOSM) return 'OpenData + OSM';
  if (hasOD && hasNat) return 'OpenData + National';
  if (hasOSM && hasNat) return 'OSM + National';
  if (hasOD) return 'OpenData uniquement';
  if (hasOSM) return 'OSM uniquement';
  if (hasNat) return 'National uniquement';
  return 'Aucune donnée';
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  var str = String(value).replace(/"/g, '""');
  return /[;\n"]/.test(str) ? '"' + str + '"' : str;
}

function exportCommunesCSV() {
  if (!communesIVData || !communesIVData.features || !communesIVData.features.length) {
    toast('Communes non chargees.', '#ef4444');
    return;
  }

  toast('Preparation du tableur communes…', '#60a5fa');

  ensureSpatialCaches(function() {
    var headers = [
      'code_insee',
      'commune',
      'departement',
      'opendata_arbres',
      'osm_arbres',
      'national_arbres',
      'total_arbres',
      'opendata_present',
      'osm_present',
      'national_present',
      'statut_donnees',
      'couverture'
    ];

    var rows = communesIVData.features.map(function(feature) {
      var props = feature.properties || {};
      var code = getCommuneCode(feature);
      var stats = communeStatsByCode[code] || createEmptyCommuneStats();
      var hasData = stats.total > 0;

      return {
        code: code || '',
        commune: props.nom || '',
        departement: props.codeDepartement || '35',
        od: stats.od,
        osm: stats.osm,
        nat: stats.nat,
        total: stats.total,
        hasOD: stats.od > 0 ? 'Oui' : 'Non',
        hasOSM: stats.osm > 0 ? 'Oui' : 'Non',
        hasNat: stats.nat > 0 ? 'Oui' : 'Non',
        statut: hasData ? 'Avec données' : 'Sans donnée',
        couverture: getCoverageClassFromStats(stats)
      };
    }).sort(function(a, b) {
      if ((b.total > 0) !== (a.total > 0)) return (b.total > 0) - (a.total > 0);
      if (b.total !== a.total) return b.total - a.total;
      return a.commune.localeCompare(b.commune, 'fr');
    });

    var csvRows = [headers.join(';')];
    rows.forEach(function(row) {
      csvRows.push([
        row.code,
        row.commune,
        row.departement,
        row.od,
        row.osm,
        row.nat,
        row.total,
        row.hasOD,
        row.hasOSM,
        row.hasNat,
        row.statut,
        row.couverture
      ].map(csvCell).join(';'));
    });

    var ts = new Date().toISOString().slice(0,10);
    downloadFile(csvRows.join('\n'), 'communes_donnees_arbres_'+ts+'.csv', 'text/csv;charset=utf-8;');
    toast(fmt(rows.length) + ' communes exportees en CSV', '#3dd68c');
  });
}

// ══════════════════════════════
// EXPORT PDF – RAPPORT PRÉDIAGNOSTIC
// ══════════════════════════════
const AUBEPINE_LOGO_URL = './aubepine-logo.png';
var pdfLogoImageCache = null;
var pdfLogoImagePromise = null;

function loadPdfLogoImage() {
  if (pdfLogoImageCache) return Promise.resolve(pdfLogoImageCache);
  if (pdfLogoImagePromise) return pdfLogoImagePromise;

  pdfLogoImagePromise = new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      pdfLogoImageCache = img;
      resolve(img);
    };
    img.onerror = function() {
      console.warn('Logo Aubepine introuvable pour le PDF.');
      pdfLogoImagePromise = null;
      resolve(null);
    };
    img.src = AUBEPINE_LOGO_URL;
  });

  return pdfLogoImagePromise;
}

async function exportPDFCommune() {
  if (!currentCommune) { toast('Sélectionner une commune d\'abord.', '#ef4444'); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('jsPDF non chargé.', '#ef4444'); return;
  }

  currentCommune = resolveCommuneFeature(currentCommune);

  var props = currentCommune.properties;
  var nom   = props.nom || 'Commune';
  var dept  = props.codeDepartement || '35';
  var now   = new Date();
  var ts    = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  var tsFile = now.toISOString().slice(0,10);
  var charterStatus = getCommuneTreeCharterStatus(currentCommune);

  // Arbres dans la commune (toutes sources actives)
  var odOn  = document.getElementById('opendata-check').checked;
  var osmOn = document.getElementById('osm-check').checked;
  var natEl = document.getElementById('national-check');
  var natOn = natEl ? natEl.checked : false;

  var arbresOD  = odOn  ? filterFeaturesByActiveEssence(filterInCommune('od',  currentCommune)) : [];
  var arbresOSM = osmOn ? filterFeaturesByActiveEssence(filterInCommune('osm', currentCommune)) : [];
  var arbresNat = natOn ? filterFeaturesByActiveEssence(filterInCommune('nat', currentCommune)) : [];
  var total = arbresOD.length + arbresOSM.length + arbresNat.length;

  var fiab = computeFiabiliteScore(arbresOD.concat(arbresOSM).concat(arbresNat));
  var logoImg = await loadPdfLogoImage();

  // Complétude
  var odC  = computeCompletude(arbresOD,  FIABILITE_FIELDS_OD.essence,  FIABILITE_FIELDS_OD.hauteur);
  var osmC = computeCompletude(arbresOSM, FIABILITE_FIELDS_OSM.essence, FIABILITE_FIELDS_OSM.hauteur);
  var natC = computeCompletude(arbresNat, FIABILITE_FIELDS_NAT.essence, FIABILITE_FIELDS_NAT.hauteur);

  // Top 5 essences locales
  var localEssIdx = {};
  var allEssFields = FIABILITE_FIELDS_OD.essence.concat(FIABILITE_FIELDS_OSM.essence).concat(FIABILITE_FIELDS_NAT.essence);
  arbresOD.concat(arbresOSM).concat(arbresNat).forEach(function(f) {
    var e = getEssence(f.properties, allEssFields);
    if (e) localEssIdx[e] = (localEssIdx[e]||0) + 1;
  });
  var topEssences = Object.entries(localEssIdx).sort(function(a,b){return b[1]-a[1];}).slice(0,5);

  // ── Génération PDF ──
  var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  var W = 210, H = 297, margin = 14, y = 0;
  var contentW = W - margin * 2;
  var pageBottom = 279;
  var dark = [11, 26, 14];
  var green = [61, 214, 140];
  var blue = [96, 165, 250];
  var pink = [244, 114, 182];
  var amber = [211, 142, 31];
  var red = [200, 84, 84];
  var ink = [46, 61, 53];
  var muted = [106, 120, 112];
  var soft = [241, 246, 242];
  var border = [222, 230, 224];
  var scoreColor = fiab.total >= 70 ? green : fiab.total >= 40 ? amber : red;
  var reliabilityText = fiab.total >= 70 ? 'Fiabilité élevée : données directement mobilisables.' :
                        fiab.total >= 40 ? 'Fiabilité moyenne : vérification terrain conseillée.' :
                        'Fiabilité faible : inventaire terrain nécessaire.';
  var reco = '';
  if (fiab.total >= 70 && fiab.sources >= 2) {
    reco = 'Les données disponibles sur cette commune sont suffisamment fiables pour engager un prédiagnostic. Un croisement avec le cadastre et une vérification ciblée restent recommandés avant intervention.';
  } else if (fiab.total >= 40) {
    reco = 'Les données sont exploitables mais encore incomplètes. Une vérification terrain ciblée est recommandée pour consolider l’inventaire avant un diagnostic plus fin.';
  } else {
    reco = 'La couverture actuelle reste insuffisante pour un prédiagnostic robuste. Un inventaire terrain plus complet est recommandé avant toute analyse approfondie.';
  }

  function normalizePdfText(value) {
    return String(value == null ? '' : value).replace(/[\u202f\u00a0]/g, ' ');
  }

  function fmtPdf(n) {
    return normalizePdfText(fmt(n));
  }

  function startPage(isFirstPage) {
    if (!isFirstPage) doc.addPage();
    doc.setFillColor(248, 250, 247);
    doc.rect(0, 0, W, H, 'F');

    if (isFirstPage) {
      doc.setFillColor(dark[0], dark[1], dark[2]);
      doc.roundedRect(margin, 10, contentW, 34, 4, 4, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(19);
      doc.setTextColor(green[0], green[1], green[2]);
      doc.text('Arbres 35', margin + 6, 21);
      doc.setFontSize(10.5);
      doc.setTextColor(224, 238, 227);
      doc.text('Rapport de prédiagnostic arboricole', margin + 6, 28);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.3);
      doc.setTextColor(155, 184, 167);
      doc.text('Territoire : ' + nom + ' · Département ' + dept + ' · ' + ts, margin + 6, 34.8);

      if (logoImg) {
        try {
          doc.setFillColor(255, 255, 255);
          doc.roundedRect(W - margin - 24, 13, 18, 18, 3, 3, 'F');
          doc.addImage(logoImg, 'PNG', W - margin - 22, 14.8, 14, 14);
        } catch (e) {
          console.warn('Impossible d\'ajouter le logo Aubepine au PDF.', e);
        }
      }

      y = 52;
    } else {
      doc.setDrawColor(border[0], border[1], border[2]);
      doc.setLineWidth(0.35);
      doc.line(margin, 14, W - margin, 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(green[0], green[1], green[2]);
      doc.text('Arbres 35', margin, 10.8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text('Rapport de prédiagnostic arboricole', W - margin, 10.8, { align: 'right' });
      y = 24;
    }
  }

  function ensureSpace(height) {
    if (y + height > pageBottom) startPage(false);
  }

  function drawFooter(pageNumber, totalPages) {
    doc.setPage(pageNumber);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.setLineWidth(0.35);
    doc.line(margin, 285, W - margin, 285);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(105, 132, 114);
    doc.text('Rapport généré par Arbres 35 – Webmapping Aubépine', margin, 290.6);
    doc.text('Page ' + pageNumber + ' / ' + totalPages, W - margin, 290.6, { align: 'right' });
  }

  function drawMetricCards() {
    ensureSpace(22);
    var gap = 4;
    var cardW = (contentW - gap * 2) / 3;
    var cardH = 18;

    function metric(x, label, value, accent, note) {
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(border[0], border[1], border[2]);
      doc.roundedRect(x, y, cardW, cardH, 3, 3, 'FD');
      doc.setFillColor(accent[0], accent[1], accent[2]);
      doc.roundedRect(x + 2, y + 2, 2, cardH - 4, 1, 1, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text(normalizePdfText(label).toUpperCase(), x + 6, y + 5.6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12.5);
      doc.setTextColor(ink[0], ink[1], ink[2]);
      doc.text(normalizePdfText(value), x + 6, y + 12.4);
      if (note) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.7);
        doc.setTextColor(134, 145, 137);
        doc.text(normalizePdfText(note), x + cardW - 4, y + 12.2, { align: 'right' });
      }
    }

    metric(margin, 'Territoire', nom, green);
    metric(margin + cardW + gap, 'Arbres', fmtPdf(total), blue);
    metric(margin + (cardW + gap) * 2, 'Fiabilité', fiab.total + ' pts', scoreColor, 'sur 100');
    y += cardH + 8;
  }

  function drawSectionTitle(title, accent, nextBlockHeight) {
    ensureSpace(12 + (nextBlockHeight || 0));
    doc.setFillColor(soft[0], soft[1], soft[2]);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.roundedRect(margin, y, contentW, 8, 2.5, 2.5, 'FD');
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.roundedRect(margin + 3, y + 1.2, 2.2, 5.6, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.6);
    doc.setTextColor(64, 86, 73);
    doc.text(title.toUpperCase(), margin + 8.5, y + 5.3);
    y += 11;
  }

  function drawRowsCard(rows) {
    var valueX = margin + 72;
    var valueW = contentW - 77;
    var layouts = rows.map(function(row) {
      doc.setFont('helvetica', row.highlight ? 'bold' : 'normal');
      doc.setFontSize(7.8);
      var lines = doc.splitTextToSize(normalizePdfText(row.value), valueW);
      var rowHeight = Math.max(9.2, lines.length * 4.8 + 3.8);
      return { row: row, lines: lines, rowHeight: rowHeight };
    });

    var cardH = 10;
    layouts.forEach(function(layout) { cardH += layout.rowHeight; });
    ensureSpace(cardH);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.roundedRect(margin, y, contentW, cardH, 3, 3, 'FD');

    var rowY = y + 7;
    layouts.forEach(function(layout, index) {
      var row = layout.row;
      if (row.highlight) {
        doc.setFillColor(236, 247, 239);
        doc.roundedRect(margin + 3, rowY - 4.8, contentW - 6, layout.rowHeight - 0.2, 1.5, 1.5, 'F');
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text(normalizePdfText(row.label), margin + 5, rowY);
      doc.setFont('helvetica', row.highlight ? 'bold' : 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(ink[0], ink[1], ink[2]);
      doc.text(layout.lines, valueX, rowY);
      if (index < layouts.length - 1) {
        doc.setDrawColor(232, 236, 233);
        doc.setLineWidth(0.2);
        doc.line(margin + 4, rowY + layout.rowHeight - 3.5, W - margin - 4, rowY + layout.rowHeight - 3.5);
      }
      rowY += layout.rowHeight;
    });

    y += cardH + 6;
  }

  function drawReliabilityCard() {
    var details = 'Confiance source +' + fiab.scoreSources + ' pts · Diversité +' + fiab.scoreDiversite + ' pts · Essence +' + fiab.scoreEssence + ' pts · Hauteur +' + fiab.scoreHauteur + ' pts · Qualité +' + fiab.scoreQualite + ' pts';
    var detailLines = doc.splitTextToSize(details, contentW - 12);
    var cardH = 28 + detailLines.length * 4.3;
    ensureSpace(cardH);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.roundedRect(margin, y, contentW, cardH, 3, 3, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    doc.text(normalizePdfText(fiab.total + ' pts'), margin + 5, y + 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(normalizePdfText(reliabilityText), margin + 38, y + 8.8);

    doc.setFillColor(232, 237, 234);
    doc.roundedRect(margin + 5, y + 16, contentW - 10, 4, 1.2, 1.2, 'F');
    doc.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    doc.roundedRect(margin + 5, y + 16, Math.max(2, Math.round((contentW - 10) * fiab.total / 100)), 4, 1.2, 1.2, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(detailLines.map(normalizePdfText), margin + 5, y + 25);

    y += cardH + 6;
  }

  function drawCompletenessCard() {
    var sourceRows = [];
    if (odC.n > 0) sourceRows.push({ label: 'OpenData · source Rennes Métropole', stats: odC, color: green });
    if (osmC.n > 0) sourceRows.push({ label: 'OSM', stats: osmC, color: blue });
    if (natC.n > 0) sourceRows.push({ label: 'Base Nationale · source namR', stats: natC, color: pink });
    if (!sourceRows.length) sourceRows.push({ label: 'Aucune donnée', stats: { essence: 0, hauteur: 0, n: 0 }, color: muted });

    var rowH = 15;
    var cardH = 8 + sourceRows.length * rowH;
    ensureSpace(cardH);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.roundedRect(margin, y, contentW, cardH, 3, 3, 'FD');

    var rowY = y + 7;
    sourceRows.forEach(function(row) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(row.color[0], row.color[1], row.color[2]);
      doc.text(normalizePdfText(row.label + (row.stats.n ? ' (' + fmtPdf(row.stats.n) + ' arbres)' : '')), margin + 5, rowY);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text('Essence', margin + 5, rowY + 5);
      doc.setFillColor(232, 237, 234);
      doc.roundedRect(margin + 26, rowY + 2.6, 52, 3, 1, 1, 'F');
      doc.setFillColor(row.color[0], row.color[1], row.color[2]);
      doc.roundedRect(margin + 26, rowY + 2.6, Math.max(1, Math.round(52 * row.stats.essence / 100)), 3, 1, 1, 'F');
      doc.setTextColor(ink[0], ink[1], ink[2]);
      doc.text(normalizePdfText(row.stats.essence + '%'), margin + 82, rowY + 5);

      doc.setTextColor(muted[0], muted[1], muted[2]);
      doc.text('Hauteur', margin + 100, rowY + 5);
      doc.setFillColor(232, 237, 234);
      doc.roundedRect(margin + 122, rowY + 2.6, 42, 3, 1, 1, 'F');
      doc.setFillColor(row.color[0], row.color[1], row.color[2]);
      doc.roundedRect(margin + 122, rowY + 2.6, Math.max(1, Math.round(42 * row.stats.hauteur / 100)), 3, 1, 1, 'F');
      doc.setTextColor(ink[0], ink[1], ink[2]);
      doc.text(normalizePdfText(row.stats.hauteur + '%'), W - margin - 5, rowY + 5, { align: 'right' });

      rowY += rowH;
    });

    y += cardH + 6;
  }

  function drawEssencesCard() {
    var cardH = topEssences.length ? 10 + topEssences.length * 7 : 18;
    ensureSpace(cardH);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.roundedRect(margin, y, contentW, cardH, 3, 3, 'FD');

    if (topEssences.length) {
      var rowY = y + 6;
      topEssences.forEach(function(item, index) {
        var pct = total > 0 ? Math.round(item[1] / total * 100) : 0;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.8);
        doc.setTextColor(muted[0], muted[1], muted[2]);
        doc.text(normalizePdfText((index + 1) + '. ' + item[0]), margin + 5, rowY);
        doc.setFont('helvetica', index === 0 ? 'bold' : 'normal');
        doc.setTextColor(ink[0], ink[1], ink[2]);
        doc.text(normalizePdfText(fmtPdf(item[1]) + ' arbres (' + pct + '%)'), W - margin - 5, rowY, { align: 'right' });
        rowY += 7;
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.8);
      doc.setTextColor(145, 155, 148);
      doc.text('Aucune essence renseignée pour cette commune.', margin + 5, y + 10);
    }

    y += cardH + 6;
  }

  function drawRecommendationCard() {
    var lines = doc.splitTextToSize(reco, contentW - 14);
    var cardH = 12 + lines.length * 4.8;
    ensureSpace(cardH);
    doc.setFillColor(245, 249, 246);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.roundedRect(margin, y, contentW, cardH, 3, 3, 'FD');
    doc.setFillColor(green[0], green[1], green[2]);
    doc.roundedRect(margin + 3, y + 3, 2, cardH - 6, 1, 1, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text(lines.map(normalizePdfText), margin + 8, y + 8);
    y += cardH + 6;
  }

  startPage(true);
  drawMetricCards();

  drawSectionTitle('1. Identification du territoire', green, 56);
  drawRowsCard([
    { label: 'Commune', value: nom },
    { label: 'Département', value: 'Ille-et-Vilaine (35)' },
    { label: 'Code INSEE', value: props.code || '–' },
    { label: 'Date du rapport', value: ts },
    { label: 'Charte de l’arbre', value: charterStatus.label }
  ]);

  drawSectionTitle('2. Inventaire arboricole – données disponibles', blue, 58);
  drawRowsCard([
    { label: 'Total arbres recensés', value: fmtPdf(total) + ' arbres', highlight: true },
    { label: 'OpenData', value: fmtPdf(arbresOD.length) + ' arbres · source Rennes Métropole' },
    { label: 'OSM', value: fmtPdf(arbresOSM.length) + ' arbres' },
    { label: 'Base Nationale', value: fmtPdf(arbresNat.length) + ' arbres · source namR' },
    { label: 'Sources présentes', value: fiab.sources + ' / 3' }
  ]);

  var reliabilityDetailText = 'Confiance source +' + fiab.scoreSources + ' pts · Diversité +' + fiab.scoreDiversite + ' pts · Essence +' + fiab.scoreEssence + ' pts · Hauteur +' + fiab.scoreHauteur + ' pts · Qualité +' + fiab.scoreQualite + ' pts';
  var reliabilityDetailLines = doc.splitTextToSize(reliabilityDetailText, contentW - 12);
  drawSectionTitle('3. Score de fiabilité des données', scoreColor, 28 + reliabilityDetailLines.length * 4.3);
  drawReliabilityCard();

  var completenessCount = 0;
  if (odC.n > 0) completenessCount++;
  if (osmC.n > 0) completenessCount++;
  if (natC.n > 0) completenessCount++;
  if (!completenessCount) completenessCount = 1;
  drawSectionTitle('4. Complétude attributaire par source', pink, 8 + completenessCount * 15);
  drawCompletenessCard();

  drawSectionTitle('5. Essences dominantes (top 5 locales)', green, topEssences.length ? 10 + topEssences.length * 7 : 18);
  drawEssencesCard();

  var recommendationLines = doc.splitTextToSize(reco, contentW - 14);
  drawSectionTitle('6. Recommandation Aubépine', green, 12 + recommendationLines.length * 4.8);
  drawRecommendationCard();

  var totalPages = doc.getNumberOfPages();
  for (var p = 1; p <= totalPages; p++) drawFooter(p, totalPages);

  doc.save('prediag_' + nom.replace(/\s+/g, '_').toLowerCase() + '_' + tsFile + '.pdf');
  toast('Rapport PDF généré : ' + nom, '#3dd68c');
}

// ══════════════════════════════
// CHARGEMENT CARTE
// ══════════════════════════════
map.on('load', function() {
  initPanelSections();
  setLoading(true);

  // Phase 1 : communes + arbres Rennes
  Promise.all([
    fetch(COMMUNES_IV_API).then(function(r){return r.json();}),
    fetch(COMMUNES_RM_API).then(function(r){return r.json();}),
    fetch(RENNES_URL_EST).then(function(r){return r.json();}),
    fetch(RENNES_URL_OUEST).then(function(r){return r.json();})
  ])
  .then(function(results) {
    setLoading(false);
    communesIVData = results[0];
    communesRMData = results[1];

    var mergedRennes = { type:'FeatureCollection',
      features: processGeoJSON(results[2]).features.concat(processGeoJSON(results[3]).features) };
    allFeaturesOpenData = mergedRennes.features;
    allFeaturesOSM      = [];
    allFeaturesNational = [];
    invalidateSpatialCaches();

    // ── Parcelles cadastrales en vecteur (IGN Géoplateforme PCI)
    // Source vector tiles PCI – on n'affiche QUE la couche 'parcelle',
    // sans labels, sans sections, sans bâtiments.
    firstDataLayerId = 'cadastre-parcelle-fill';
    map.addSource('pci-source', {
      type: 'vector',
      tiles: ['https://data.geopf.fr/tms/1.0.0/PCI/{z}/{x}/{y}.pbf'],
      minzoom: 13,
      maxzoom: 17,
      attribution: '© IGN – Géoplateforme / PCI'
    });
    // Fond léger des parcelles
    map.addLayer({
      id: 'cadastre-parcelle-fill',
      type: 'fill',
      source: 'pci-source',
      'source-layer': 'parcelle',
      minzoom: 15,
      layout: { visibility: 'visible' },
      paint: {
        'fill-color': 'rgba(251,191,36,0.06)',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, 1]
      }
    });
    // Contour des parcelles
    map.addLayer({
      id: 'cadastre-parcelle-line',
      type: 'line',
      source: 'pci-source',
      'source-layer': 'parcelle',
      minzoom: 15,
      layout: { visibility: 'visible' },
      paint: {
        'line-color': '#fbbf24',
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 17, 1.2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, 0.65]
      }
    });

    // Overlays OSM + ortho (sous le cadastre et toutes les données)
    initBasemapOverlays();
    map.addSource('communes-iv', { type:'geojson', data:communesIVData, promoteId:'code' });
    map.addLayer({ id:'communes-iv-fill', type:'fill', source:'communes-iv',
      paint:{'fill-color':['case',['boolean',['feature-state','selected'],false],'rgba(167,139,250,0.12)','rgba(255,255,255,0.01)'],'fill-opacity':1} });
    map.addLayer({ id:'communes-iv-line', type:'line', source:'communes-iv',
      paint:{'line-color':['case',['boolean',['feature-state','selected'],false],'#a78bfa','rgba(255,255,255,0.12)'],
              'line-width':['case',['boolean',['feature-state','selected'],false],1.5,0.5]} });

    // Arbres OpenData
    map.addSource('arbres', { type:'geojson', data:mergedRennes });
    map.addLayer({ id:'arbres-layer', type:'circle', source:'arbres',
      paint:{'circle-radius':TREE_RADIUS_EXPR,
              'circle-color':'#4ade80','circle-stroke-color':'rgba(0,0,0,0.3)','circle-stroke-width':TREE_STROKE_WIDTH_EXPR,
              'circle-opacity':TREE_OPACITY_EXPR} });

    // Arbres OSM (vide → phase 2)
    map.addSource('arbres-osm', { type:'geojson', data:{type:'FeatureCollection',features:[]} });
    map.addLayer({ id:'arbres-osm-layer', type:'circle', source:'arbres-osm',
      layout:{visibility:'none'},
      paint:{'circle-radius':TREE_RADIUS_EXPR,
              'circle-color':'#60a5fa','circle-stroke-color':'rgba(0,0,0,0.3)','circle-stroke-width':TREE_STROKE_WIDTH_EXPR,
              'circle-opacity':TREE_OPACITY_EXPR} });

    // Arbres National (vide → phase 2)
    map.addSource('arbres-national', { type:'geojson', data:{type:'FeatureCollection',features:[]} });
    map.addLayer({ id:'arbres-national-layer', type:'circle', source:'arbres-national',
      layout:{visibility:'none'},
      paint:{'circle-radius':TREE_RADIUS_EXPR,
              'circle-color':'#f472b6','circle-stroke-color':'rgba(0,0,0,0.3)','circle-stroke-width':TREE_STROKE_WIDTH_EXPR,
              'circle-opacity':TREE_OPACITY_EXPR} });

    map.on('zoom', function(){
      var z=map.getZoom();
      var row=document.getElementById('cadastre-row'), hint=document.getElementById('cadastre-zoom-hint');
      if(row)  row.style.opacity  = z>=15?'1':'0.4';
      if(hint) hint.textContent   = z>=15?'':'(zoom 15+)';
    });

    // Init UI
    document.getElementById('osm-check').checked = false;
    var nc0 = document.getElementById('national-check'); if(nc0){ nc0.checked=false; }
    updateKPIs();
    renderDonutGlobal();
    rebuildQualityAnomalies();
    setTimeout(function(){
      rebuildSpatialCaches(function() {
        if (currentCommune) showCommuneCard(currentCommune);
      });
    }, 0);

    toast(fmt(mergedRennes.features.length)+' arbres OpenData (Rennes)', '#4ade80');
    setTimeout(function(){toast(fmt(communesIVData.features.length)+' communes 35', '#a78bfa');}, 400);

    // Phase 2 : RM + OSM + National en différé
    setTimeout(function(){
      setLoading(true);
      Promise.all([
        fetch(RM_URL_EST).then(function(r){return r.json();}),
        fetch(RM_URL_OUEST).then(function(r){return r.json();}),
        fetch(OSM_URL).then(function(r){return r.json();}),
        fetch(NATIONAL_URL).then(function(r){return r.json();})
      ]).then(function(res){
        setLoading(false);
        var rmF  = processGeoJSON(res[0]).features.concat(processGeoJSON(res[1]).features);
        var osmF = processOSM(res[2]).features;
        var natF = processNational(res[3]).features;

        allFeaturesOpenData = allFeaturesOpenData.concat(rmF);
        allFeaturesOSM      = osmF;
        allFeaturesNational = natF;
        invalidateSpatialCaches();

        if(map.getSource('arbres'))          map.getSource('arbres').setData({type:'FeatureCollection',features:allFeaturesOpenData});
        if(map.getSource('arbres-osm'))      map.getSource('arbres-osm').setData({type:'FeatureCollection',features:allFeaturesOSM});
        if(map.getSource('arbres-national')) map.getSource('arbres-national').setData({type:'FeatureCollection',features:allFeaturesNational});
        rebuildQualityAnomalies();

        // Activer OSM + National
        document.getElementById('osm-check').checked = true;
        if(map.getLayer('arbres-osm-layer')) map.setLayoutProperty('arbres-osm-layer','visibility','visible');
        var nc = document.getElementById('national-check');
        if(nc){ nc.disabled=false; nc.checked=true;
          var natRow = document.getElementById('national-row'); if(natRow){ natRow.style.opacity='1'; natRow.title=''; } }
        if(map.getLayer('arbres-national-layer')) map.setLayoutProperty('arbres-national-layer','visibility','visible');

        updateKPIs(); renderDonutGlobal();
        rebuildSpatialCaches(function() {
          // Recalculer le choroplèthe si actif
          if (choroplethActive) {
            choroplethData = null;
            computeChoroplethFast(function() { applyChoropleth(); });
          }
          // Construire l'index des essences et afficher le graphique
          setTimeout(function(){
            renderEssenceChart();
            renderCompletudeAttr();
            renderCompletudeChart();
            initComparePanel();
            if (currentCommune) showCommuneCard(currentCommune);
          }, 50);
        });

        toast(fmt(rmF.length)+' arbres OpenData · source Rennes Metropole','#4ade80');
        setTimeout(function(){toast(fmt(osmF.length)+' arbres OSM','#60a5fa');},400);
        setTimeout(function(){toast(fmt(natF.length)+' arbres Base Nationale · source namR','#f472b6');},800);
      }).catch(function(err){
        setLoading(false); console.error('Phase 2:',err); toast('⚠ Erreur chargement données','#ef4444');
      });
    }, 800);

    // ══ COMPARAISON SOURCES ══
    var chartCompletudeChart = null;
    var overlapDone = false;

    function renderCompletudeChart() {
      // Top 10 communes RM par total d'arbres, stacked par source
      var communeData = communesRMData.features.map(function(c) {
        var stats = communeStatsByCode[getCommuneCode(c)] || createEmptyCommuneStats();
        return {
          name: c.properties.nom,
          od:   stats.od,
          osm:  stats.osm,
          nat:  stats.nat
        };
      }).filter(function(d){ return d.od+d.osm+d.nat > 0; })
        .sort(function(a,b){ return (b.od+b.osm+b.nat)-(a.od+a.osm+a.nat); })
        .slice(0, 10);

      if (!communeData.length) return;

      var labels = communeData.map(function(d){ return d.name; });
      if (chartCompletudeChart) { chartCompletudeChart.destroy(); chartCompletudeChart = null; }

      chartCompletudeChart = new Chart(document.getElementById('cvs-completude'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label:'OpenData', data: communeData.map(function(d){return d.od;}),  backgroundColor:'rgba(61,214,140,0.75)', borderRadius:3, borderSkipped:false },
            { label:'OSM',      data: communeData.map(function(d){return d.osm;}), backgroundColor:'rgba(96,165,250,0.75)', borderRadius:3, borderSkipped:false },
            { label:'National', data: communeData.map(function(d){return d.nat;}), backgroundColor:'rgba(244,114,182,0.75)', borderRadius:3, borderSkipped:false }
          ]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'bottom',
              labels: { color:'rgba(200,230,210,0.6)', font:{size:10}, boxWidth:10, padding:8 }
            },
            tooltip: {
              callbacks: { label: function(ctx){ return ' '+ctx.dataset.label+' : '+fmt(ctx.raw); } },
              backgroundColor:'rgba(8,13,10,0.96)', titleColor:'#dff0e4', bodyColor:'#dff0e4',
              borderColor:'rgba(61,214,140,0.2)', borderWidth:1
            }
          },
          scales: {
            x: { stacked:true, grid:{color:'rgba(61,214,140,0.06)'},
              ticks:{color:'rgba(200,230,210,0.35)',font:{size:10},callback:function(v){return v>=1000?Math.round(v/1000)+'k':v;}} },
            y: { stacked:true, grid:{display:false},
              ticks:{color:'rgba(200,230,210,0.6)',font:{size:10}} }
          }
        }
      });
    }

    function computeOverlapThresholds(featA, featB, thresholdsM) {
      // Version rapide : on repère le plus proche voisin dans un rayon max,
      // puis on classe le recoupement dans 3 seuils de distance.
      var thresholds = thresholdsM.slice().sort(function(a, b) { return a - b; });
      var thresholdSq = thresholds.map(function(radiusM) {
        var radiusDeg = radiusM / 111320;
        return radiusDeg * radiusDeg;
      });
      var maxRadiusSq = thresholdSq[thresholdSq.length - 1];

      var grid = {};
      var cell = 0.005; // ~500m
      featB.forEach(function(f) {
        var c = f.geometry.coordinates;
        var key = Math.round(c[0]/cell)+'|'+Math.round(c[1]/cell);
        if (!grid[key]) grid[key] = [];
        grid[key].push(c);
      });

      var cumulative = thresholds.map(function() { return 0; });
      featA.forEach(function(f) {
        var c = f.geometry.coordinates;
        var cx = Math.round(c[0]/cell), cy = Math.round(c[1]/cell);
        var minDistSq = Infinity;
        for (var dx=-1; dx<=1; dx++) {
          for (var dy=-1; dy<=1; dy++) {
            var neighbors = grid[(cx+dx)+'|'+(cy+dy)] || [];
            for (var i=0; i<neighbors.length; i++) {
              var dx2 = c[0]-neighbors[i][0], dy2 = c[1]-neighbors[i][1];
              var distSq = dx2*dx2 + dy2*dy2;
              if (distSq <= maxRadiusSq && distSq < minDistSq) minDistSq = distSq;
            }
          }
        }
        if (minDistSq === Infinity) return;
        for (var t = 0; t < thresholdSq.length; t++) {
          if (minDistSq <= thresholdSq[t]) cumulative[t]++;
        }
      });

      return {
        thresholds: thresholds,
        cumulative: cumulative,
        bins: cumulative.map(function(count, index) {
          return index === 0 ? count : count - cumulative[index - 1];
        })
      };
    }

    function runOverlapCalc() {
      if (overlapDone) return;
      overlapDone = true;
      document.getElementById('overlap-loading').style.display = 'flex';

      setTimeout(function() {
        var thresholds = [5, 10, 20];
        var odOsm = computeOverlapThresholds(allFeaturesOpenData, allFeaturesOSM, thresholds);
        var odNat = computeOverlapThresholds(allFeaturesOpenData, allFeaturesNational, thresholds);
        var osmNat = computeOverlapThresholds(allFeaturesOSM, allFeaturesNational, thresholds);

        function pct(n, tot) { return tot > 0 ? Math.round(n / tot * 100) + '%' : '0%'; }
        function renderOverlapStats(result, total, baseLabel) {
          return '<div class="ov-breakdown">' +
            '<div class="ov-tier"><span class="ov-tier-label">&lt; 5 m</span><span class="ov-tier-val">' + fmt(result.bins[0]) + ' (' + pct(result.bins[0], total) + ')</span></div>' +
            '<div class="ov-tier"><span class="ov-tier-label">5-10 m</span><span class="ov-tier-val">' + fmt(result.bins[1]) + ' (' + pct(result.bins[1], total) + ')</span></div>' +
            '<div class="ov-tier"><span class="ov-tier-label">10-20 m</span><span class="ov-tier-val">' + fmt(result.bins[2]) + ' (' + pct(result.bins[2], total) + ')</span></div>' +
            '<span class="ov-base">sur ' + fmt(total) + ' ' + baseLabel + '</span>' +
          '</div>';
        }

        document.getElementById('ov-od-osm').innerHTML =
          renderOverlapStats(odOsm, allFeaturesOpenData.length, 'OpenData');
        document.getElementById('ov-od-nat').innerHTML =
          renderOverlapStats(odNat, allFeaturesOpenData.length, 'OpenData');
        document.getElementById('ov-osm-nat').innerHTML =
          renderOverlapStats(osmNat, allFeaturesOSM.length, 'OSM');

        document.getElementById('overlap-loading').style.display = 'none';
      }, 50);
    }

    function initComparePanel() {
      document.querySelectorAll('.cmp-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
          document.querySelectorAll('.cmp-tab').forEach(function(t){ t.classList.remove('active'); });
          document.querySelectorAll('.cmp-pane').forEach(function(p){ p.style.display='none'; });
          tab.classList.add('active');
          var pane = document.getElementById('cmp-'+tab.dataset.tab);
          if (pane) pane.style.display = 'block';
          if (tab.dataset.tab === 'overlap' && !overlapDone) runOverlapCalc();
        });
      });
    }

    // ══ CHECKBOXES ══
    document.getElementById('opendata-check').addEventListener('change', function(e){
      if(map.getLayer('arbres-layer')) map.setLayoutProperty('arbres-layer','visibility',e.target.checked?'visible':'none');
      renderDonutGlobal(); if(currentCommune) showCommuneCard(currentCommune);
    });
    document.getElementById('osm-check').addEventListener('change', function(e){
      if(map.getLayer('arbres-osm-layer')) map.setLayoutProperty('arbres-osm-layer','visibility',e.target.checked?'visible':'none');
      renderDonutGlobal(); if(currentCommune) showCommuneCard(currentCommune);
    });
    var nc3 = document.getElementById('national-check');
    if(nc3) nc3.addEventListener('change', function(e){
      if(map.getLayer('arbres-national-layer')) map.setLayoutProperty('arbres-national-layer','visibility',e.target.checked?'visible':'none');
      renderDonutGlobal(); if(currentCommune) showCommuneCard(currentCommune);
    });
    document.getElementById('cadastre-check').addEventListener('change', function(e){
      var vis = e.target.checked ? 'visible' : 'none';
      if(map.getLayer('cadastre-parcelle-fill')) map.setLayoutProperty('cadastre-parcelle-fill','visibility',vis);
      if(map.getLayer('cadastre-parcelle-line')) map.setLayoutProperty('cadastre-parcelle-line','visibility',vis);
    });

    // Choroplèthe couverture
    document.getElementById('choropleth-check').addEventListener('change', function(e){
      toggleChoropleth(e.target.checked);
    });

    // Export CSV / GeoJSON
    document.getElementById('btn-export-csv').addEventListener('click', function(){
      exportCSV(lastSelectionFeatures);
    });
    document.getElementById('btn-export-geojson').addEventListener('click', function(){
      exportGeoJSON(lastSelectionFeatures);
    });
    var btnExportCommunes = document.getElementById('btn-export-communes-csv');
    if (btnExportCommunes) btnExportCommunes.addEventListener('click', exportCommunesCSV);

    // Export PDF commune
    var btnPdf = document.getElementById('btn-pdf-commune');
    if (btnPdf) btnPdf.addEventListener('click', function(){ exportPDFCommune(); });

    // Fond de carte
    document.querySelectorAll('.bm-btn').forEach(function(btn){
      btn.addEventListener('click', function(){ switchBasemap(btn.dataset.style); });
    });

    // Essences : bouton clear
    var essenceClearBtn = document.getElementById('essence-clear-btn');
    if (essenceClearBtn) essenceClearBtn.addEventListener('click', clearEssenceFilter);

    // ══ HOVER / CLIC COMMUNES IV ══
    var hoveredIV = null;
    map.on('mousemove','communes-iv-fill', function(e){
      if(drawMode) return;
      if(hoveredIV!==null && hoveredIV!==selectedId) map.setFeatureState({source:'communes-iv',id:hoveredIV},{selected:false});
      hoveredIV = e.features[0].id;
      if(hoveredIV!==selectedId) map.setFeatureState({source:'communes-iv',id:hoveredIV},{selected:true});
      map.getCanvas().style.cursor='pointer';
    });
    map.on('mouseleave','communes-iv-fill', function(){
      if(hoveredIV!==null && hoveredIV!==selectedId) map.setFeatureState({source:'communes-iv',id:hoveredIV},{selected:false});
      hoveredIV=null; map.getCanvas().style.cursor='';
    });
    map.on('click','communes-iv-fill', function(e){
      if(drawMode) return;
      var treeHits = map.queryRenderedFeatures(e.point, {
        layers: ['arbres-layer', 'arbres-osm-layer', 'arbres-national-layer']
      });
      if (treeHits.length) return;
      var feat=resolveCommuneFeature(e.features[0]);
      if(selectedId!==null){ try{map.setFeatureState({source:'communes-iv',id:selectedId},{selected:false});}catch(er){} }
      selectedId=feat.id||feat.properties.code; currentCommune=feat;
      map.setFeatureState({source:'communes-iv',id:selectedId},{selected:true});
      flyToCommune(feat); showCommuneCard(feat);
      e.stopPropagation&&e.stopPropagation();
    });

    // Fermer commune card
    document.getElementById('commune-card-close').addEventListener('click', closeCommuneCard);
    map.on('click', function(e){
      if(drawMode) return;
      var hits=map.queryRenderedFeatures(e.point,{layers:['communes-iv-fill','arbres-layer','arbres-osm-layer','arbres-national-layer']});
      if(!hits.length) closeCommuneCard();
    });

    // ══ POPUPS ARBRES ══
    var pStyle='padding:6px 10px;font-family:DM Sans,sans-serif;font-size:12px;background:rgba(11,14,20,0.96);color:#e2e8f0;border-radius:8px;border:1px solid rgba(255,255,255,0.1)';
    var popup    = new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:10});
    var popupOSM = new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:10});
    var popupNat = new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:10});

    map.on('mouseenter','arbres-layer', function(e){ if(drawMode)return; map.getCanvas().style.cursor='pointer';
      var p=e.features[0].properties; popup.setLngLat(e.lngLat).setHTML('<div style="'+pStyle+'"><strong style="color:#4ade80">'+(p.nom_commun||'Arbre')+'</strong><br><span style="color:rgba(255,255,255,.4);font-size:11px">OpenData</span><br><span style="color:rgba(255,255,255,.32);font-size:10px">source : Rennes Metropole</span></div>').addTo(map); });
    map.on('mouseleave','arbres-layer', function(){ if(drawMode)return; map.getCanvas().style.cursor=''; popup.remove(); });

    map.on('mouseenter','arbres-osm-layer', function(e){ if(drawMode)return; map.getCanvas().style.cursor='pointer';
      popupOSM.setLngLat(e.lngLat).setHTML('<div style="'+pStyle+'"><strong style="color:#60a5fa">OpenStreetMap</strong></div>').addTo(map); });
    map.on('mouseleave','arbres-osm-layer', function(){ if(drawMode)return; map.getCanvas().style.cursor=''; popupOSM.remove(); });

    map.on('mouseenter','arbres-national-layer', function(e){ if(drawMode)return; map.getCanvas().style.cursor='pointer';
      var p=e.features[0].properties; popupNat.setLngLat(e.lngLat).setHTML('<div style="'+pStyle+'"><strong style="color:#f472b6">'+(p.nom_commun||p.essence||'Arbre')+'</strong><br><span style="color:rgba(255,255,255,.4);font-size:11px">Base Nationale</span><br><span style="color:rgba(255,255,255,.32);font-size:10px">source : namR</span></div>').addTo(map); });
    map.on('mouseleave','arbres-national-layer', function(){ if(drawMode)return; map.getCanvas().style.cursor=''; popupNat.remove(); });

    // ══ CLIC ARBRE → INFO PANEL ══
    function showTreeInfo(props, label, color) {
      setPanelSectionExpanded('info-section', true);
      var rows=Object.entries(props)
        .filter(function(kv){
          return kv[0]!=='geo_point_2d' &&
                 kv[1]!==null &&
                 kv[1]!=='' &&
                 kv[1]!=='null';
        })
        .map(function(kv){return '<div class="info-row"><span class="info-label">'+kv[0]+'</span><span class="info-value">'+kv[1]+'</span></div>';}).join('');
      document.getElementById('info-content').innerHTML =
        '<div style="color:'+color+';font-weight:600;margin-bottom:6px;font-size:10px;text-transform:uppercase;letter-spacing:.6px">'+label+'</div>'
        +(rows||'<em style="color:rgba(255,255,255,.3)">Aucune donnée.</em>');
    }
    map.on('click','arbres-layer', function(e){ if(drawMode)return; showTreeInfo(e.features[0].properties,'OpenData · source Rennes Metropole','#4ade80'); e.stopPropagation&&e.stopPropagation(); });
    map.on('click','arbres-osm-layer', function(e){ if(drawMode)return; showTreeInfo(e.features[0].properties,'OpenStreetMap','#60a5fa'); e.stopPropagation&&e.stopPropagation(); });
    map.on('click','arbres-national-layer', function(e){ if(drawMode)return; showTreeInfo(e.features[0].properties,'Base Nationale · source namR','#f472b6'); e.stopPropagation&&e.stopPropagation(); });

    // ══ RECHERCHE (communes IV seulement) ══
    var allCommunes = communesIVData.features.map(function(f){return {name:f.properties.nom,feature:f};});
    var searchInput   = document.getElementById('commune-search');
    var searchResults = document.getElementById('search-results');

    searchInput.addEventListener('input', function(){
      var q=searchInput.value.trim().toLowerCase();
      if(!q){searchResults.style.display='none';return;}
      var matches=allCommunes.filter(function(c){return c.name.toLowerCase().includes(q);}).slice(0,8);
      if(!matches.length){searchResults.style.display='none';return;}
      searchResults.innerHTML=matches.map(function(c){
        return '<div class="search-result-item"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2"/></svg>'+c.name+'</div>';
      }).join('');
      searchResults.style.display='block';
      searchResults.querySelectorAll('.search-result-item').forEach(function(el,i){
        el.addEventListener('click', function(){
          var c=matches[i]; searchInput.value=''; searchResults.style.display='none';
          if(selectedId!==null){try{map.setFeatureState({source:'communes-iv',id:selectedId},{selected:false});}catch(e){}}
          selectedId=c.feature.id||c.feature.properties.code; currentCommune=c.feature;
          try{map.setFeatureState({source:'communes-iv',id:selectedId},{selected:true});}catch(e){}
          flyToCommune(c.feature); showCommuneCard(c.feature);
        });
      });
    });
    document.addEventListener('click', function(e){ if(!e.target.closest('#search-wrap')) searchResults.style.display='none'; });

    // ══ DESSIN ══
    document.getElementById('btn-draw').addEventListener('click', function(){ drawMode?stopDraw():startDraw(); });
    document.getElementById('btn-clear').addEventListener('click', function(){
      cancelDraw(); clearPolygon();
      drawMarkers.forEach(function(m){m.remove();}); drawMarkers=[];
      document.getElementById('selection-count').textContent='Zone vide';
      lastSelectionFeatures = null;
      var exportBtns = document.getElementById('export-btns');
      if (exportBtns) exportBtns.style.display = 'none';
    });
    map.on('click', function(e){
      if(!drawMode) return;
      if(e.originalEvent&&e.originalEvent.detail>=2) return;
      drawPoints.push([e.lngLat.lng,e.lngLat.lat]);
      var dot=document.createElement('div');
      dot.style.cssText='width:8px;height:8px;border-radius:50%;background:#4ade80;border:2px solid rgba(0,0,0,.5)';
      drawMarkers.push(new maplibregl.Marker({element:dot}).setLngLat(e.lngLat).addTo(map));
      document.getElementById('selection-count').textContent=drawPoints.length+' point(s) · double-clic pour finir';
    });
    map.on('mousemove', function(e){ if(drawMode&&drawPoints.length) updatePreview(e.lngLat); });
    map.on('dblclick', function(e){
      if(!drawMode) return;
      e.preventDefault();
      if(drawPoints.length>0){ drawPoints.pop(); var lm=drawMarkers.pop(); if(lm)lm.remove(); }
      stopDraw();
    });

  })
  .catch(function(err){
    setLoading(false);
    console.error('Phase 1:',err);
    toast('⚠ Erreur de chargement des données','#ef4444');
  });

}); // fin map.on('load')
