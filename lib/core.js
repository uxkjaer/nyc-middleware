const hook = require('istanbul-lib-hook'),
    cp = require('child_process'),
    im = require('istanbul-lib-instrument'),
    // TreeSummarizer = istanbul.TreeSummarizer,
    baselineCoverage = {},
    libCoverage = require('istanbul-lib-coverage'),
    fs = require('fs'),
    parse = require('node-html-parser').parse;


//single place to get global coverage object
function getCoverageObject() {
    /*jslint nomen: true */
    global.__coverage__ = global.__coverage__ || {};
    return global.__coverage__;
}

//returns a matcher that returns all JS files under root
//except when the file is anywhere under `node_modules`
//does not use istanbul.matcherFor() so as to expose
//a synchronous interface
function getRootMatcher(root) {
    return function (file) {
        if (file.indexOf(root) !== 0) { return false; }
        file = file.substring(root.length);
        if (file.indexOf('node_modules') >= 0) { return false; }
        return true;
    };
}

//deep-copy object
function clone(obj) {
    if (!obj) { return obj; }
    return JSON.parse(JSON.stringify(obj));
}
/**
 * save the baseline coverage stats for a file. This baseline is not 0
 * because of mainline code that is covered as part of loading the module
 * @method saveBaseline
 * @param file the file for which baseline stats need to be tracked.
 * @private
 */
function saveBaseline(file) {
    var coverageObject = getCoverageObject(),
        fileCoverage;
    if (coverageObject && coverageObject[file]) {
        fileCoverage = coverageObject[file];
        if (!baselineCoverage[file]) {
            baselineCoverage[file] = {
                s: clone(fileCoverage.s),
                f: clone(fileCoverage.f),
                b: clone(fileCoverage.b)
            };
        }
    }
}
/**
 * overwrites the coverage stats for the global coverage object to restore to baseline
 * @method restoreBaseline
 */
function restoreBaseline() {
    var cov = getCoverageObject(),
        fileCoverage,
        fileBaseline;
    Object.keys(baselineCoverage).forEach(function (file) {
        fileBaseline = baselineCoverage[file];
        if (cov[file]) {
            fileCoverage = cov[file];
            fileCoverage.s = clone(fileBaseline.s);
            fileCoverage.f = clone(fileBaseline.f);
            fileCoverage.b = clone(fileBaseline.b);
        }
    });
    Object.keys(cov).forEach(function (file) {
        if (!baselineCoverage[file]) { //throw it out
            delete cov[file];
        }
    });
}
/**
 * hooks `require` to add instrumentation to matching files loaded on the server
 * @method hookLoader
 * @param {Function|String} matcherOrRoot one of:
 *      a match function with signature `fn(file)` that returns true if `file` needs to be instrumented
 *      a root path under which all JS files except those under `node_modules` are instrumented
 * @param {Object} opts instrumenter options
 */
function hookLoader(matcherOrRoot, opts) {
    /*jslint nomen: true */
    var matcherFn,
        transformer,
        postLoadHook,
        postLoadHookFn;

    opts = opts || {};
    opts.coverageVariable = '__coverage__'; //force this always

    postLoadHook = opts.postLoadHook;
    if (!(postLoadHook && typeof postLoadHook === 'function')) {
        postLoadHook = function (/* matcher, transformer, verbose */) { return function (/* file */) {}; };
    }
    delete opts.postLoadHook;

    if (typeof matcherOrRoot === 'function') {
        matcherFn = matcherOrRoot;
    } else if (typeof matcherOrRoot === 'string') {
        matcherFn = getRootMatcher(matcherOrRoot);
    } else {
        throw new Error('Argument was not a function or string');
    }

    if (instrumenter) { return; } //already hooked
    instrumenter =  im.createInstrumenter();
    transformer = instrumenter.instrumentSync.bind(instrumenter);
    postLoadHookFn = postLoadHook(matcherFn, transformer, opts.verbose);

    hook.hookRequire(matcherFn, transformer, {
        verbose: opts.verbose,
        postLoadHook: function (file) {
            postLoadHookFn(file);
            saveBaseline(file);
        }
    });
}

function render(filePath, res, prefix) {
    var collector = libCoverage,
        // treeSummary,
        pathMap,
        linkMapper,
        outputNode,
        report,
        fileCoverage,
        coverage = getCoverageObject();

    if (!(coverage && Object.keys(coverage).length > 0)) {
        res.setHeader('Content-type', 'text/plain');
        return res.end('No coverage information has been collected'); //TODO: make this a fancy HTML report
    }

    createCoverage();

    let index = fs.readFileSync(process.cwd() +"/coverage/index.html");

    const indexHtml = parse(index);
    indexHtml.querySelector('.pad1').appendChild(`<button type="submit" id="btnDownload" onclick="window.open('/coverage/download')">Download report</button>`);
    
    fs.writeFileSync(process.cwd() +"/coverage/index.html", indexHtml.toString());
    
    res.setHeader('Content-type', 'text/html');
  
    res.redirect("/coverage/public");

    res.end();
}

function mergeClientCoverage(obj) {
    if (!obj) { return; }
    var coverage = getCoverageObject();
    Object.keys(obj).forEach(function (filePath) {
        // var original = coverage[filePath],
           var  added = obj[filePath],
            result;
        // if (original) {
        //     // result = utils.mergeFileCoverage(original, added);
        // } else {
            result = added;
        // }
        coverage[filePath] = result;
    });
    
}

function createCoverage() {
    const dir = process.cwd() +"/.nyc_output/",
        coverage = getCoverageObject();
    
        if (!fs.existsSync(dir)) {
        
        fs.mkdirSync(dir, 0744);
        
    }
    fs.writeFileSync(dir + "out.json", JSON.stringify(coverage));

    cp.spawnSync('nyc report --reporter=html', null, {shell: true});
}


module.exports = {
    getCoverageObject: getCoverageObject,
    getInstrumenter: function () { return instrumenter; },
    restoreBaseline: restoreBaseline,
    hookLoader: hookLoader,
    render: render,
    mergeClientCoverage: mergeClientCoverage,
    createCoverage: createCoverage
};


