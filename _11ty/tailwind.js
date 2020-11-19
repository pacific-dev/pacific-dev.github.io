const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const fg = require("fast-glob");
const util = require("util");
const mkdirp = require("mkdirp");
const postcss = require("postcss");
const tailwindcss = require("tailwindcss");
const autoprefixer = require("autoprefixer");
const CleanCSS = require("clean-css");

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

function log(msg, isError) {
  if (isError) msg = "\u001b[31mError!\u001b[39m " + msg;

  const pluginName = "Eleventy-Plugin-TailwindCSS";

  console.log(`[\x1b[34m${pluginName}\x1b[0m] ${msg}`);
}

async function writer(fileNames, options) {
  try {
    const postcssPlugins = [
      tailwindcss(options.configFile),
      ...(options.autoprefixer
        ? [autoprefixer(options.autoprefixerOptions)]
        : []),
    ];

    for (let [src, dest] of fileNames) {
      let rawFile = await readFile(src);
      let { css: processedFile } = await postcss(postcssPlugins).process(
        rawFile,
        {
          from: src,
          to: dest,
        }
      );

      if (options.minify) {
        processedFile = new CleanCSS(options.minifyOptions).minify(
          processedFile
        ).styles;
      }

      await mkdirp(path.dirname(dest));
      await writeFile(dest, processedFile);

      log(`Wrote ${dest} from ${src}`);
    }
  } catch (error) {
    log(error, true);
  }
}

async function processor(options, isWatch) {
  const elev = this;
  const inputDir = elev.inputDir;
  const outputDir = elev.outputDir;
  const defaultOptions = {
    src: path.posix.join(inputDir, "**/*.css"),
    dest: ".",
    configFile: "tailwind.config.js",
    watchEleventyWatchTargets: false,
    keepFolderStructure: true,
    autoprefixer: true,
    autoprefixerOptions: {},
    minify: true,
    minifyOptions: {},
  };

  options = { ...defaultOptions, ...options, inputDir, outputDir };
  options.dest = path.join(outputDir, options.dest);

  if (!fs.existsSync(options.configFile)) {
    options.configFile = undefined;
  } else {
    log("Using " + options.configFile + " as configuration file");
  }

  let excludeGlob = [options.dest, "**/!(*.css)", "node_modules/**/*"];
  let watchList = await fg(options.src, {
    ignore: excludeGlob,
  });
  const fileNames = watchList.map((src) => {
    let baseName = path.basename(src);
    let subDir = "";
    if (options.keepFolderStructure) {
      let pathToFile = path.relative(options.inputDir, path.dirname(src));
      if (pathToFile !== "") {
        subDir = pathToFile.replace(/^\.\.\/?/, "");
      }
    }
    let dest = path.join(options.dest, subDir, baseName);
    return [src, dest];
  });

  await writer(fileNames, options);

  if (isWatch) {
    let ignores = [];

    if (options.watchEleventyWatchTargets) {
      await this.initWatch();
      watchList = watchList.concat(await this.getWatchedFiles());
      ignores = ignores.concat(this.eleventyFiles.getGlobWatcherIgnores());
    }

    const watcher = chokidar.watch(watchList, {
      ignored: ignores,
    });

    watcher.on("change", (path) => {
      log("File changed: " + path);

      writer(fileNames, options).then(() => {
        elev.eleventyServe.reload();
        log("Watching…");
      });
    });

    log("Watching…");
  }
};

function monkeypatch(cls, fn) {
  const orig = cls.prototype[fn.name].__original || cls.prototype[fn.name];

  function wrapped() {
    return fn.bind(this, orig).apply(this, arguments);
  }

  wrapped.__original = orig;

  cls.prototype[fn.name] = wrapped;
}


module.exports = (_, options = {}) => {
  setImmediate(function () {
    const Eleventy = require('@11ty/eleventy');
    let firstRun = true;
    let isWatch = false;

    monkeypatch(Eleventy, async function watch(original) {
      isWatch = true;
      return await original.apply(this, arguments);
    });

    monkeypatch(Eleventy, async function write(original) {
      if (firstRun && !this.isDryRun) {
        await processor.call(this, options, isWatch);
      }

      firstRun = false;
      return await original.apply(this, arguments);
    });

  });
};
