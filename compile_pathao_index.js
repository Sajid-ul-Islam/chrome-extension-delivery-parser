/**
 * compile_pathao_index.js
 * Compiles raw pathao_coverage.json (5.9 MB) into an ultra-fast, lean pathao_zone_index.json (~100 KB).
 * Maps every city, zone, and common alias to exact Pathao city_id and zone_id.
 */

const fs = require('fs');
const path = require('path');
const parser = require('./parser.js');

const rawPath = path.join(__dirname, 'pathao_coverage.json');
const outputPath = path.join(__dirname, 'pathao_zone_index.json');

if (!fs.existsSync(rawPath)) {
  console.error('Error: pathao_coverage.json not found!');
  process.exit(1);
}

console.log('Loading pathao_coverage.json...');
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

const cityMap = {};
const zoneMap = {};

// Helper to normalize search keys
function cleanKey(str) {
  if (!str) return '';
  return str.toString()
    .toLowerCase()
    .trim()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .replace(/\s+/g, ' ');
}

// 1. Process Cities
for (const city of raw.cities) {
  const cName = city.city_name.trim();
  const cId = city.city_id;
  const baseKey = cleanKey(cName);
  
  const cityEntry = { id: cId, name: cName };
  cityMap[baseKey] = cityEntry;

  // Add aliases from BD_DISTRICTS in parser.js if matched
  if (Array.isArray(parser.BD_DISTRICTS)) {
    const distObj = parser.BD_DISTRICTS.find(d => cleanKey(d.name) === baseKey || (d.aliases && d.aliases.some(a => cleanKey(a) === baseKey)));
    if (distObj) {
      for (const alias of [distObj.name, ...(distObj.aliases || [])]) {
        cityMap[cleanKey(alias)] = cityEntry;
      }
    }
  }
}

// Common city spellings / aliases
const CITY_EXTRA_ALIASES = {
  "dhaka": ["dacca", "ঢাকা", "dhaka city", "dhaka metro"],
  "chattogram": ["chittagong", "ctg", "চট্টগ্রাম", "chittagong city"],
  "bogura": ["bogra", "বগুড়া", "বগুড়া"],
  "jashore": ["jessore", "যশোর"],
  "cumilla": ["comilla", "কুমিল্লা"],
  "barishal": ["barisal", "বরিশাল"],
  "brahmanbaria": ["bbaria", "b.baria", "ব্রাহ্মণবাড়িয়া", "ব্রাহ্মণবাড়িয়া"],
  "cox's bazar": ["coxsbazar", "coxs bazar", "কক্সবাজার"],
  "moulvibazar": ["moulvibazar", "মৌলভীবাজার"],
  "chapainawabganj": ["nawabganj", "চাঁপাইনবাবগঞ্জ"],
  "khagrachhari": ["khagrachari", "খাগড়াছড়ি"],
  "netrokona": ["netrokona", "নেত্রকোণা", "নেত্রকোনা"],
  "kishoreganj": ["kishorganj", "কিশোরগঞ্জ"]
};

for (const [canonical, aliases] of Object.entries(CITY_EXTRA_ALIASES)) {
  const normCan = cleanKey(canonical);
  const targetCity = cityMap[normCan];
  if (targetCity) {
    for (const a of aliases) {
      cityMap[cleanKey(a)] = targetCity;
    }
  }
}

// 2. Process Zones
for (const city of raw.cities) {
  const cId = city.city_id;
  const cName = city.city_name.trim();

  if (Array.isArray(city.zones)) {
    for (const zone of city.zones) {
      const zId = zone.zone_id;
      const zName = zone.zone_name.trim();
      const zKey = cleanKey(zName);

      const zoneEntry = {
        c_id: cId,
        c_name: cName,
        z_id: zId,
        z_name: zName
      };

      zoneMap[zKey] = zoneEntry;

      // Also index key combined with city: e.g. "kishoreganj mithamoin"
      zoneMap[`${cleanKey(cName)} ${zKey}`] = zoneEntry;

      // If zone ends with " Sadar", also index the base without Sadar if not already taken
      if (/ sadar$/i.test(zName)) {
        const baseWithoutSadar = cleanKey(zName.replace(/ sadar$/i, ''));
        if (!zoneMap[baseWithoutSadar]) {
          zoneMap[baseWithoutSadar] = zoneEntry;
        }
      }
    }
  }
}

// Cross-reference with parser.js DHAKA_ZONES
if (Array.isArray(parser.DHAKA_ZONES)) {
  const dhakaCity = cityMap["dhaka"];
  if (dhakaCity) {
    for (const dz of parser.DHAKA_ZONES) {
      const dzName = typeof dz === 'object' ? dz.name : dz;
      const aliases = typeof dz === 'object' ? (dz.aliases || []) : [];
      const normDzName = cleanKey(dzName);

      // Find best match in Dhaka zones
      let targetZ = null;
      for (const [k, v] of Object.entries(zoneMap)) {
        if (v.c_id === dhakaCity.id && (k === normDzName || k.startsWith(normDzName + ' ') || k.includes(normDzName))) {
          targetZ = v;
          break;
        }
      }

      if (targetZ) {
        if (!zoneMap[normDzName]) zoneMap[normDzName] = targetZ;
        for (const a of aliases) {
          const aKey = cleanKey(a);
          if (aKey && !zoneMap[aKey]) {
            zoneMap[aKey] = targetZ;
          }
        }
      }
    }
  }
}

// Cross-reference with parser.js OTHER_CITY_ZONES
if (parser.OTHER_CITY_ZONES) {
  for (const [distName, zonesList] of Object.entries(parser.OTHER_CITY_ZONES)) {
    const distKey = cleanKey(distName);
    const matchedCity = cityMap[distKey];
    if (Array.isArray(zonesList)) {
      for (const z of zonesList) {
        const zName = typeof z === 'object' ? z.name : z;
        const aliases = typeof z === 'object' ? (z.aliases || []) : [];
        const normZName = cleanKey(zName);

        // Find existing zone entry
        let existing = zoneMap[normZName];
        if (!existing && matchedCity) {
          // Look up zone under this city
          for (const [k, v] of Object.entries(zoneMap)) {
            if (v.c_id === matchedCity.id && (k.includes(normZName) || normZName.includes(k))) {
              existing = v;
              break;
            }
          }
        }

        if (existing) {
          for (const a of aliases) {
            const aKey = cleanKey(a);
            if (aKey) {
              zoneMap[aKey] = existing;
              if (matchedCity) {
                zoneMap[`${cleanKey(matchedCity.name)} ${aKey}`] = existing;
              }
            }
          }
        }
      }
    }
  }
}

// Add special handling for common edge-case thanas/zones:
const SPECIAL_ZONE_MAPPINGS = [
  { zone_query: "mithamain", target_zone: "mithamoin", city: "kishoreganj" },
  { zone_query: "mithamian", target_zone: "mithamoin", city: "kishoreganj" },
  { zone_query: "মিঠামইন", target_zone: "mithamoin", city: "kishoreganj" },
  { zone_query: "মিঠামাইন", target_zone: "mithamoin", city: "kishoreganj" },
  { zone_query: "chandgaon", target_zone: "chandgaon", city: "chattogram" },
  { zone_query: "titas", target_zone: "titash", city: "cumilla" },
  { zone_query: "benapole", target_zone: "benapole", city: "jashore" },
  { zone_query: "বেনাপোল", target_zone: "benapole", city: "jashore" },
  { zone_query: "mirpur", target_zone: "mirpur 10", city: "dhaka" },
  { zone_query: "মিরপুর", target_zone: "mirpur 10", city: "dhaka" }
];

for (const spec of SPECIAL_ZONE_MAPPINGS) {
  const cEntry = cityMap[cleanKey(spec.city)];
  if (cEntry) {
    const targetZ = Object.values(zoneMap).find(v => v.c_id === cEntry.id && cleanKey(v.z_name) === cleanKey(spec.target_zone));
    if (targetZ) {
      zoneMap[cleanKey(spec.zone_query)] = targetZ;
    }
  }
}

const compiled = {
  version: "1.0",
  compiled_at: new Date().toISOString(),
  stats: {
    cities_count: Object.keys(cityMap).length,
    zones_count: Object.keys(zoneMap).length
  },
  cities: cityMap,
  zones: zoneMap
};

fs.writeFileSync(outputPath, JSON.stringify(compiled), 'utf8');

const outputSize = fs.statSync(outputPath).size;
console.log(`✅ Successfully compiled pathao_zone_index.json!`);
console.log(`- Total indexed city keys: ${Object.keys(cityMap).length}`);
console.log(`- Total indexed zone keys: ${Object.keys(zoneMap).length}`);
console.log(`- Final File Size: ${(outputSize / 1024).toFixed(1)} KB`);
