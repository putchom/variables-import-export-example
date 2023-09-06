console.clear();

function createCollection(name) {
  const currentCollection = figma.variables
    .getLocalVariableCollections()
    .find((e) => e.name === name);
  const collection =
    currentCollection || figma.variables.createVariableCollection(name);

  if (!currentCollection) {
    collection.renameMode(collection.modes[0].modeId, "light");
    collection.addMode("dark");
  }

  const lightModeId = collection.modes[0].modeId;
  const darkModeId = collection.modes[1].modeId;

  return {
    collection,
    lightModeId,
    darkModeId,
  };
}

function createToken(
  collection,
  lightModeId,
  darkModeId,
  type,
  name,
  lightModeValue,
  darkModeValue
) {
  console.log(name);
  const token =
    figma.variables
      .getLocalVariables()
      .find(
        (e) => e.name === name && e.variableCollectionId === collection.id
      ) || figma.variables.createVariable(name, collection.id, type);
  token.setValueForMode(lightModeId, lightModeValue);
  token.setValueForMode(darkModeId, darkModeValue);
  return token;
}

function createVariable(
  collection,
  lightModeId,
  darkModeId,
  key,
  lightModeValueKey,
  darkModeValueKey,
  tokens
) {
  const lightModeToken = tokens[lightModeValueKey];
  const darkModeToken = tokens[darkModeValueKey];
  return createToken(
    collection,
    lightModeId,
    darkModeId,
    lightModeToken.resolvedType,
    key,
    {
      type: "VARIABLE_ALIAS",
      id: `${lightModeToken.id}`,
    },
    {
      type: "VARIABLE_ALIAS",
      id: `${darkModeToken.id}`,
    }
  );
}

function importJSONFile({ fileName, body }) {
  const json = JSON.parse(body);
  const { collection, lightModeId, darkModeId } = createCollection(fileName);
  const aliases = {};
  const tokens = {};
  Object.entries(json).forEach(([key, object]) => {
    traverseToken({
      collection,
      lightModeId,
      darkModeId,
      type: json.$type,
      key,
      object,
      tokens,
      aliases,
    });
  });
  processAliases({
    collection,
    lightModeId,
    darkModeId,
    aliases,
    tokens,
  });
}

function processAliases({
  collection,
  lightModeId,
  darkModeId,
  aliases,
  tokens,
}) {
  aliases = Object.values(aliases);
  let generations = aliases.length;
  while (aliases.length && generations > 0) {
    for (let i = 0; i < aliases.length; i++) {
      const { key, type, lightModeValueKey, darkModeValueKey } = aliases[i];
      const lightModeToken = tokens[lightModeValueKey];
      const darkModeToken = tokens[darkModeValueKey];
      if (lightModeToken || darkModeToken) {
        aliases.splice(i, 1);
        tokens[key] = createVariable(
          collection,
          lightModeId,
          darkModeId,
          key,
          lightModeValueKey,
          darkModeValueKey,
          tokens
        );
      }
    }
    generations--;
  }
}

function isAlias(value) {
  return value.toString().trim().charAt(0) === "{";
}

function traverseToken({
  collection,
  lightModeId,
  darkModeId,
  type,
  key,
  object,
  tokens,
  aliases,
}) {
  type = type || object.$type;
  // if key is a meta field, move on
  if (key.charAt(0) === "$") {
    return;
  }
  if (object.$value !== undefined) {
    if (isAlias(object.$value)) {
      const lightModeValueKey = object.$value
        .trim()
        .replace(/\./g, "/")
        .replace(/[\{\}]/g, "");

      const darkModeValueKey =
        object.$modes !== undefined
          ? object.$modes.dark
              .trim()
              .replace(/\./g, "/")
              .replace(/[\{\}]/g, "")
          : object.$value
              .trim()
              .replace(/\./g, "/")
              .replace(/[\{\}]/g, "");
      if (tokens[lightModeValueKey] || tokens[darkModeValueKey]) {
        console.log("found alias", key, lightModeValueKey, darkModeValueKey);
        tokens[key] = createVariable(
          collection,
          lightModeId,
          darkModeId,
          key,
          lightModeValueKey,
          darkModeValueKey,
          tokens
        );
      } else {
        console.log(
          "not found alias",
          key,
          lightModeValueKey,
          darkModeValueKey
        );
        aliases[key] = {
          key,
          type,
          lightModeValueKey,
          darkModeValueKey,
        };
      }
    } else if (type === "color") {
      tokens[key] = createToken(
        collection,
        lightModeId,
        darkModeId,
        "COLOR",
        key,
        parseColor(object.$value),
        object.$modes !== undefined
          ? parseColor(object.$modes.dark)
          : parseColor(object.$value)
      );
    } else if (type === "number") {
      tokens[key] = createToken(
        collection,
        lightModeId,
        darkModeId,
        "FLOAT",
        key,
        object.$value,
        object.$modes !== undefined ? object.$modes.dark : object.$value
      );
    } else if (type === "dimension") {
      tokens[key] = createToken(
        collection,
        lightModeId,
        darkModeId,
        "FLOAT",
        key,
        parseDimension(object.$value),
        object.$modes !== undefined
          ? parseDimension(object.$modes.dark)
          : parseDimension(object.$value)
      );
    } else {
      console.log("unsupported type", type, object);
    }
  } else {
    Object.entries(object).forEach(([key2, object2]) => {
      if (key2.charAt(0) !== "$") {
        traverseToken({
          collection,
          lightModeId,
          darkModeId,
          type,
          key: `${key}/${key2}`,
          object: object2,
          tokens,
          aliases,
        });
      }
    });
  }
}

function parseDimension(dimension) {
  return Number(dimension.replace("px", ""));
}

function exportToJSON() {
  const collections = figma.variables.getLocalVariableCollections();
  const files = [];
  collections.forEach((collection) =>
    files.push(...processCollection(collection))
  );
  figma.ui.postMessage({ type: "EXPORT_RESULT", files });
}

function processCollection({ name, modes, variableIds }) {
  const files = [];
  modes.forEach((mode) => {
    const file = { fileName: `${name}.${mode.name}.tokens.json`, body: {} };
    variableIds.forEach((variableId) => {
      const { name, resolvedType, valuesByMode } =
        figma.variables.getVariableById(variableId);
      const value = valuesByMode[mode.modeId];
      if (value !== undefined && ["COLOR", "FLOAT"].includes(resolvedType)) {
        let obj = file.body;
        name.split("/").forEach((groupName) => {
          obj[groupName] = obj[groupName] || {};
          obj = obj[groupName];
        });
        obj.$type = resolvedType === "COLOR" ? "color" : "number";
        if (value.type === "VARIABLE_ALIAS") {
          obj.$value = `{${figma.variables
            .getVariableById(value.id)
            .name.replace(/\//g, ".")}}`;
        } else {
          obj.$value = resolvedType === "COLOR" ? rgbToHex(value) : value;
        }
      }
    });
    files.push(file);
  });
  return files;
}

figma.ui.onmessage = (e) => {
  console.log("code received message", e);
  if (e.type === "IMPORT") {
    const { fileName, body } = e;
    importJSONFile({ fileName, body });
  } else if (e.type === "EXPORT") {
    exportToJSON();
  }
};
if (figma.command === "import") {
  figma.showUI(__uiFiles__["import"], {
    width: 500,
    height: 500,
    themeColors: true,
  });
} else if (figma.command === "export") {
  figma.showUI(__uiFiles__["export"], {
    width: 500,
    height: 500,
    themeColors: true,
  });
}

function rgbToHex({ r, g, b, a }) {
  if (a !== 1) {
    return `rgba(${[r, g, b]
      .map((n) => Math.round(n * 255))
      .join(", ")}, ${a.toFixed(4)})`;
  }
  const toHex = (value) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  const hex = [toHex(r), toHex(g), toHex(b)].join("");
  return `#${hex}`;
}

function parseColor(color) {
  color = color.trim();
  const rgbRegex = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;
  const rgbaRegex =
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/;
  const hslRegex = /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/;
  const hslaRegex =
    /^hsla\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*,\s*([\d.]+)\s*\)$/;
  const hexRegex = /^#([A-Fa-f0-9]{3}){1,2}$/;
  const floatRgbRegex =
    /^\{\s*r:\s*[\d\.]+,\s*g:\s*[\d\.]+,\s*b:\s*[\d\.]+(,\s*opacity:\s*[\d\.]+)?\s*\}$/;

  if (rgbRegex.test(color)) {
    const [, r, g, b] = color.match(rgbRegex);
    return { r: parseInt(r) / 255, g: parseInt(g) / 255, b: parseInt(b) / 255 };
  } else if (rgbaRegex.test(color)) {
    const [, r, g, b, a] = color.match(rgbaRegex);
    return {
      r: parseInt(r) / 255,
      g: parseInt(g) / 255,
      b: parseInt(b) / 255,
      a: parseFloat(a),
    };
  } else if (hslRegex.test(color)) {
    const [, h, s, l] = color.match(hslRegex);
    return hslToRgbFloat(parseInt(h), parseInt(s) / 100, parseInt(l) / 100);
  } else if (hslaRegex.test(color)) {
    const [, h, s, l, a] = color.match(hslaRegex);
    return Object.assign(
      hslToRgbFloat(parseInt(h), parseInt(s) / 100, parseInt(l) / 100),
      { a: parseFloat(a) }
    );
  } else if (hexRegex.test(color)) {
    const hexValue = color.substring(1);
    const expandedHex =
      hexValue.length === 3
        ? hexValue
            .split("")
            .map((char) => char + char)
            .join("")
        : hexValue;
    return {
      r: parseInt(expandedHex.slice(0, 2), 16) / 255,
      g: parseInt(expandedHex.slice(2, 4), 16) / 255,
      b: parseInt(expandedHex.slice(4, 6), 16) / 255,
    };
  } else if (floatRgbRegex.test(color)) {
    return JSON.parse(color);
  } else {
    throw new Error("Invalid color format");
  }
}

function hslToRgbFloat(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  if (s === 0) {
    return { r: l, g: l, b: l };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, (h + 1 / 3) % 1);
  const g = hue2rgb(p, q, h % 1);
  const b = hue2rgb(p, q, (h - 1 / 3) % 1);

  return { r, g, b };
}
