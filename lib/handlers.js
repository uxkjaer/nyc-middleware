
var path = require("path"),
  fs = require("fs"),
  core = require("./core"),
  bodyParser = require("body-parser"),
  existsSync = fs.existsSync || path.existsSync,
  url = require("url"),
  ZipWriter = require('./zip-writer'),
  express = require("express"),
  rimraf = require('rimraf'),
  JS_RE = /\.js$/;

/**
 * Set default max limit to 100mb for incoming JSON and urlencoded
 * @type {String}
 */
var fileSizeMaximum = "100mb";
var isExtended = true;

function createHandler(opts) {
  /*jslint nomen: true */
  opts = opts || {};

  var app = express();
  // using separete options objects to maintain readability as the objects are getting more complex
  var urlOptions = {
    extended: isExtended,
    limit: fileSizeMaximum,
  };
  var jsonOptions = {
    limit: fileSizeMaximum,
  };

  // //send static file for /asset/asset-name
  // app.use('/asset', express.static(ASSETS_DIR));
  // app.use('/asset', express.static(path.join(ASSETS_DIR, 'vendor')));
  app.use("/public", express.static(path.join(process.cwd(), "coverage")));

  app.use(bodyParser.urlencoded(urlOptions));
  app.use(bodyParser.json(jsonOptions));

  // show main page for coverage report for /
  app.get("/", function (req, res) {
    var origUrl = url.parse(req.originalUrl).pathname,
      origLength = origUrl.length;
    if (origUrl.charAt(origLength - 1) !== "/") {
      origUrl += "/";
    }

    core.render(null, res, origUrl);
  });

  //show page for specific file/ dir for /show?file=/path/to/file
  app.get("/show", function (req, res) {
    var origUrl = url.parse(req.originalUrl).pathname,
      u = url.parse(req.url).pathname,
      pos = origUrl.indexOf(u),
      file = req.query.p;
    if (pos >= 0) {
      origUrl = origUrl.substring(0, pos);
    }
    if (!file) {
      res.setHeader("Content-type", "text/plain");
      return res.end("[p] parameter must be specified");
    }
    core.render(file, res, origUrl);
  });

  //reset coverage to baseline on POST /reset
  app.post("/reset", function (req, res) {
    core.restoreBaseline();
    res.json({
      ok: true,
    });
  });

  //opt-in to allow resets on GET as well (useful for easy browser-based demos :)
  if (opts.resetOnGet) {
    app.get("/reset", function (req, res) {
      core.restoreBaseline();
      res.json({
        ok: true,
      });
    });
  }

  //return global coverage object on /object as JSON
  app.get("/object", function (req, res) {
    res.json(core.getCoverageObject() || {});
  });

  //send self-contained download package with coverage and reports on /download
  app.get("/download", async function (req, res) {
    try {
        
        core.createCoverage();
        const zipName = __dirname + "/coverage.zip";
        await ZipWriter.writeZip(zipName);
        res.statusCode = 200;
        res.setHeader("Content-type", "application/zip");
        res.setHeader("Content-Disposition", "attachment; filename=coverage.zip");
        var filestream = fs.createReadStream(zipName);
        filestream.pipe(res);
        
        // res.download(zipName);
        rimraf(zipName, function(err) {
          console.log(err);
      });
    }
    catch (err){
        res.statusCode = 404;
    }
  });

  //merge client coverage posted from browser
  app.post("/client", function (req, res) {
    var body = req.body;
    if (!(body && typeof body === "object")) {
      //probably needs to be more robust
      return res.send(
        400,
        "Please post an object with content-type: application/json"
      );
    }
    core.mergeClientCoverage(body);
    core.createCoverage();
    res.json({
      ok: true,
    });
  });

  return app;
}

function defaultClientMatcher(req) {
  var parsed = url.parse(req.url);
  return parsed.pathname && parsed.pathname.match(JS_RE);
}

function defaultPathTransformer(root) {
  return function (req) {
    var parsed = url.parse(req.url),
      pathName = parsed.pathname;
    if (pathName && pathName.charAt(0) === "/") {
      pathName = pathName.substring(1);
    }
    return path.resolve(root, pathName);
  };
}

function clientHandler(matcher, pathTransformer, opts) {
  var verbose = opts.verbose;

  return function (req, res, next) {
    if (!matcher(req)) {
      return next();
    }
    var fullPath = pathTransformer(req);
    if (!fullPath) {
      return next();
    }

    if (!core.getInstrumenter()) {
      console.error(
        "No instrumenter set up, please call createHandler() before you use the client middleware"
      );
      return next();
    }
    if (!existsSync(fullPath)) {
      console.warn("Could not find file [" + fullPath + "], ignoring");
      return next();
    }
    fs.readFile(fullPath, "utf8", function (err, contents) {
      var instrumented;
      if (err) {
        console.warn("Error reading file: " + fullPath);
        return next();
      }
      try {
        instrumented = core
          .getInstrumenter()
          .instrumentSync(contents, fullPath);
        if (verbose) {
          console.log(
            "Sending instrumented code for: " + fullPath + ", url:" + req.url
          );
        }
        res.setHeader("Content-type", "application/javascript");
        return res.send(instrumented);
      } catch (ex) {
        console.warn("Error instrumenting file:" + fullPath);
        return next();
      }
    });
  };
}

function createClientHandler(root, opts) {
  opts = opts || {};

  var app = express(),
    matcher = opts.matcher || defaultClientMatcher,
    pathTransformer = opts.pathTransformer || defaultPathTransformer(root);
  app.get("*", clientHandler(matcher, pathTransformer, opts));
  return app;
}

module.exports = {
  createClientHandler: createClientHandler,
  createHandler: createHandler,
  hookLoader: core.hookLoader,
  getInstrumenter: core.getInstrumenter,
};
