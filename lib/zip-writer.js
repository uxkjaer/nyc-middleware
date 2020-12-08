const fs = require('fs'),
    archiver = require('archiver'),
    rimraf = require('rimraf'),
    getFiles = require('node-recursive-directory');



/**
 * Packages local files into a ZIP archive
 *
 * @param {dir} directory of source files.
 * @param {name} the zip archive file name
 * return {void}
 */
writeZip = async function() {
    return new Promise(async (resolve, reject) => {

        if (!fs.existsSync(__dirname + "/../assets")){
            fs.mkdirSync(__dirname + "/../assets");
        }
        const zipName = __dirname + "/../assets/coverage.zip",
        baseDir = process.cwd() +"/coverage/",
        output = fs.createWriteStream(zipName),
        archive = archiver("zip", {
            zlib: {
              level: 9,
            }, // Sets the compression level.
          });
        
    
        output.on('close', () => {
            //Delete the coverage folder
            cleanUp(baseDir);
            resolve();
        });
    
        archive.on("warning", function (err) {
            reject(err);
        });
    
        
        archive.on("error", async function (err) {
          reject(err);
        });

        archive.pipe(output);

        await archive.directory(baseDir, '/').finalize();
      
    });
};

/**
 * Returns array of file names from specified directory
 *
 * @param {dir} directory of source files.
 * return {array}
 */
getDirectoryList = async function(dir){
    const files = await getFiles(dir, true);
    return files;
};

/**
 * Performs cleanup of the download process
 * Deletes download directory
 *
 * @param {dir} directory of source files.
 * return {void}
 */
cleanUp = function(dir) {
    rimraf(dir, function(err) {
        console.log(err);
    });
};

module.exports = {
    writeZip: writeZip
};

