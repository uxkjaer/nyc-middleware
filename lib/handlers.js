/*
 Copyright (c) 2013, Yahoo! Inc.  All rights reserved.
 Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 */
var path = require('path'),
    fs = require('fs'),
    core = require('./core'),
    istanbul = require.resolve('nyc'),
    bodyParser = require('body-parser'),
    // ASSETS_DIR = istanbul.assetsDir,
    existsSync = fs.existsSync || path.existsSync,
    url = require('url'),
    archiver = require('archiver'),
    ZipWriter = require('./zip-writer'),
    express = require('express'),
    // Report = require('istanbul-lib-report'),
    cp = require('child_process'),
    // Collector = istanbul.Collector,
    // utils = istanbul.utils,
    JS_RE = /\.js$/;
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const coverageMap = require('istanbul-lib-coverage');


/**
 * Set default max limit to 100mb for incoming JSON and urlencoded
 * @type {String}
 */
var fileSizeMaximum = '100mb';
var isExtended = true;

function createHandler(opts) {
    /*jslint nomen: true */
    opts = opts || {};

    var app = express();
    // using separete options objects to maintain readability as the objects are getting more complex
    var urlOptions = {
        extended: isExtended,
        limit: fileSizeMaximum
    };
    var jsonOptions = {
        limit: fileSizeMaximum
    };

    // //send static file for /asset/asset-name
    // app.use('/asset', express.static(ASSETS_DIR));
    // app.use('/asset', express.static(path.join(ASSETS_DIR, 'vendor')));

    app.use(bodyParser.urlencoded(urlOptions));
    app.use(bodyParser.json(jsonOptions));

    //show main page for coverage report for /
    app.get('/', function (req, res) {
        var origUrl = url.parse(req.originalUrl).pathname,
            origLength = origUrl.length;
        if (origUrl.charAt(origLength - 1) !== '/') {
            origUrl += '/';
        }
        core.render(null, res, origUrl);
    });

    //show page for specific file/ dir for /show?file=/path/to/file
    app.get('/show', function (req, res) {
        var origUrl = url.parse(req.originalUrl).pathname,
            u = url.parse(req.url).pathname,
            pos = origUrl.indexOf(u),
            file = req.query.p;
        if (pos >= 0) {
            origUrl = origUrl.substring(0, pos);
        }
        if (!file) {
            res.setHeader('Content-type', 'text/plain');
            return res.end('[p] parameter must be specified');
        }
        core.render(file, res, origUrl);
    });

    //reset coverage to baseline on POST /reset
    app.post('/reset', function (req, res) {
        core.restoreBaseline();
        res.json({
            ok: true
        });
    });

    //opt-in to allow resets on GET as well (useful for easy browser-based demos :)
    if (opts.resetOnGet) {
        app.get('/reset', function (req, res) {
            core.restoreBaseline();
            res.json({
                ok: true
            });
        });
    }

    //return global coverage object on /object as JSON
    app.get('/object', function (req, res) {
        res.json(core.getCoverageObject() || {});
    });

    //send self-contained download package with coverage and reports on /download
    app.get('/download', async function (req, res) {
        var stream = archiver('zip', {
            zlib: {
                level: 9
            } // Sets the compression level.
        }),
            writer = new ZipWriter(stream, process.cwd()),
            coverageObject = core.getCoverageObject() || {},
            // collector = new Collector(),
            baseDir = process.cwd();
        //  reports = [
        //      Report.create('html', {
        //          writer: writer,
        //          dir: path.join(baseDir, 'lcov-report')
        //      }),
        //      Report.create('lcovonly', {
        //          writer: writer,
        //          dir: baseDir
        //      })
        //  ];


        const covMap = coverageMap.createFileCoverage(coverageObject);
        console.log(covMap);
        const configWatermarks = {
            statements: [50, 80],
            functions: [50, 80],
            branches: [50, 80],
            lines: [50, 80]
        };

        // create a context for report generation
        const context = libReport.createContext({
            dir: baseDir,
            // The summarizer to default to (may be overridden by some reports)
            // values can be nested/flat/pkg. Defaults to 'pkg'
            defaultSummarizer: 'nested',
            watermarks: configWatermarks,
            covMap,
        });

        // create an instance of the relevant report class, passing the
        // report name e.g. json/html/html-spa/text
        const report = reports.create('json', {
            skipEmpty: configSkipEmpty,
            skipFull: configSkipFull
        });

        // call execute to synchronously create and write the report to disk
        report.execute(context);
        // utils.removeDerivedInfo(coverageObject);
        // collector.add(coverageObject);

        res.statusCode = 200;
        res.setHeader('Content-type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=coverage.zip');
        stream.pipe(res);
        var dir = baseDir + '/.nyc_output';
        console.log(dir);
        if (!fs.existsSync(dir)) {
            console.log("im here");
            fs.mkdirSync(dir, 0744);
            fs.writeFileSync(dir + "/out.json", JSON.stringify(coverageObject, undefined, 4));
        }
        writer.writeFile('coverage.json', function (w) {
            w.write(JSON.stringify(coverageObject, undefined, 4));
        });
        // cp.spawn('nyc report', null, {shell: true});
        // reports.forEach(function (report) {
        //     // report.writeReport(collector);
        //     console.log(report);
        // });
        writer.done();
    });

    //merge client coverage posted from browser
    app.post('/client', function (req, res) {
        var body = req.body;
        if (!(body && typeof body === 'object')) { //probably needs to be more robust
            return res.send(400, 'Please post an object with content-type: application/json');
        }
        core.mergeClientCoverage(body);
        res.json({
            ok: true
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
        if (pathName && pathName.charAt(0) === '/') {
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
            console.error('No instrumenter set up, please call createHandler() before you use the client middleware');
            return next();
        }
        if (!existsSync(fullPath)) {
            console.warn('Could not find file [' + fullPath + '], ignoring');
            return next();
        }
        fs.readFile(fullPath, 'utf8', function (err, contents) {
            var instrumented;
            if (err) {
                console.warn('Error reading file: ' + fullPath);
                return next();
            }
            try {
                instrumented = core.getInstrumenter().instrumentSync(contents, fullPath);
                if (verbose) {
                    console.log('Sending instrumented code for: ' + fullPath + ', url:' + req.url);
                }
                res.setHeader('Content-type', 'application/javascript');
                return res.send(instrumented);
            } catch (ex) {
                console.warn('Error instrumenting file:' + fullPath);
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
    app.get('*', clientHandler(matcher, pathTransformer, opts));
    return app;
}

module.exports = {
    createClientHandler: createClientHandler,
    createHandler: createHandler,
    hookLoader: core.hookLoader,
    getInstrumenter: core.getInstrumenter
};