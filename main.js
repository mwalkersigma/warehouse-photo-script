const {google} = require('googleapis');
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

const {sep} = path;
const surplusProcurementFolderID = "1-BnROAnMCiylGBlBfiuonvSi3rxl4zk7"
const externalDrive = `${sep}${sep}10.100.100.10${sep}Surplus_Storage${sep}warehouse${sep}`;

const oneHunderedAndEightyDays = 15552000000;
const oneYear = 31536000000;

function surplusStorageCleanUp(){
    console.log("Cleaning up photos ( Local )")
    let photosDirectory = path.join(externalDrive);
    let files = fs.readdirSync(photosDirectory);
    let oneYearAgo = Date.now() - oneYear;
    for (let i = 0; i < files.length; i++) {
        let file = files[i];
        let filePath = path.join(photosDirectory, file);
        let fileStats = fs.statSync(filePath);
        if(fileStats.birthtimeMs < oneYearAgo){
            console.log(`Deleting file: ${file}`);
            fs.unlinkSync(filePath);
            console.log(`Finished deleting file: ${file}`);
        }
    }
    console.log("Finished cleaning up photos ( Local )")
}

const getDriveService = () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'cert.json'),
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const driveService = google.drive({version: 'v3', auth});
    return driveService;
}

function progressBar(percent, text = ""){
    const dots = "*".repeat(percent/5)
    const left = 20 - percent/5
    const empty = " ".repeat(left)
    process.stdout.write(`\r[${dots}${empty}] ${percent}%     ${text}`);
}

async function processPhotos(externalDriveFolder) {
    let photosDirectory = path.join(__dirname, '/photos');
    let files = fs.readdirSync(photosDirectory);

    progressBar(0, `Starting compressing all photos in folder: ${photosDirectory}`);

    for (let i = 0; i < files.length; i++) {
        let file = files[i];
        let filePath = path.join(photosDirectory, file);
        progressBar(
            Math.floor((i / files.length) * 100),
            `Compressing photo: ${file} and sending to ${externalDriveFolder}`
        );
        await compressPhoto(filePath, path.join(externalDriveFolder, file));
        progressBar(
            Math.floor((i / files.length) * 100),
            `Finished compressing photo: ${file} and sending to ${externalDriveFolder}`
        )
    }
    progressBar(
        100,
        `Finished compressing all photos in folder: ${photosDirectory}`
    )
    console.log("==================================")

    console.log("Cleaning up photos ( Local )")
    await localCleanUp(files, photosDirectory);
}

async function compressPhoto(filePath, outPath = undefined) {
    let image = await Jimp.read(filePath);
    return await image
        ['resize'](768, Jimp.AUTO)
        .quality(85)
        .write(outPath || filePath);

}

async function setupExternalDriveFolder(folderName) {
    let externalDriveFolder = path.join(externalDrive, folderName);
    if (!fs.existsSync(externalDriveFolder)) {
        fs.mkdirSync(externalDriveFolder);
        return externalDriveFolder;
    }
    return externalDriveFolder + sep;
}


async function driveCleanUp(createdTime, driveService, filesInFolder) {
    console.log(`Folder is ${Math.floor((Date.now() - new Date(createdTime).getTime()) / 86400000)} days old`);
    if (Date.now() - new Date(createdTime).getTime() > oneHunderedAndEightyDays) {
        console.log("Deleting folder from Google Drive");
        for (let {id: fileId, name: photoName} of filesInFolder) {
            console.log(`Deleting photo: ${photoName}`);
            await driveService
                .files
                .delete({fileId});
            console.log(`Finished deleting photo: ${photoName}`);

        }
        console.log("Finished deleting folder from Google Drive");
    } else {
        console.log("Folder is not old enough to delete");
        console.log("It is safe, for now.....");
    }
}

async function localCleanUp(files, photosDirectory) {
    console.log("Starting : LocalCleanUp");
    console.log("==================================")
    console.log("Cleaning up photos ( Local ) progress")
    progressBar(0, `Cleaning up photos ( Local ) progress`)
    for (let i = 0; i < files.length; i++) {
        let file = files[i];
        progressBar(
            Math.floor((i / files.length) * 100),
            `Deleting file: ${file}`
        );
        let filePath = path.join(photosDirectory, file);
        fs.unlinkSync(filePath);
        progressBar(
            Math.floor((i / files.length) * 100),
            `Finished deleting file: ${file}`
        )
    }
    progressBar(
        100,
        `Finished cleaning up photos ( Local )`
    )
    console.log("==================================")
}

async function downloadPhotos(filesInFolder, folderName, driveService,body={}) {
    console.log("Starting : DownloadPhotos");
    console.log("==================================")
    console.log(`Downloading all files in folder: ${folderName}`)
    progressBar(0, ` 0 / ${filesInFolder.length}    Downloading all files in folder: ${folderName}`)
    for (let j = 0; j < filesInFolder.length; j++) {
        await new Promise((resolve, reject) => {
            const {id: fileId, name: fileName} = filesInFolder[j];
            progressBar(
                Math.floor((j / filesInFolder.length) * 100),
                `${j} / ${filesInFolder.length}  Downloading file: ${folderName} - ${fileName} - ${fileId}`
            )
            driveService
                .files
                .get({...body,...{
                    fileId: fileId,
                    alt: 'media'
                }}, {responseType: 'stream'})
                .then(res => {
                    const dest = path.join(__dirname, '/photos', `${folderName}-${fileName}`);
                    const writeStream = fs.createWriteStream(dest);
                    res.data
                        .on('end', () => {
                            progressBar(
                                Math.floor((j / filesInFolder.length) * 100),
                                `Downloaded file: ${folderName} - ${fileName} - ${fileId}`
                            )
                            resolve();
                        })
                        .on('error', err => {
                            console.error(`Error downloading file: ${folderName}`);
                            console.error(err);
                        })
                        .pipe(writeStream);
                })
        });
    }
    progressBar(
        100,
        `${filesInFolder.length} / ${filesInFolder.length} Finished downloading all files in folder:  ${folderName}`
    )
}

async function downloadAndProcessAllPhotosFromFolder(folders, externalDriveDirectory, driveService, body = {}) {
    console.log("Starting : DownloadAndProcessAllPhotosFromFolder");
    console.log("==================================")
    for (let i = 0; i < folders.length; i++) {
        const {id: folderId, name: folderName, createdTime} = folders[i];
        console.log(`Getting all files in folder: ${folderName}`);
        let reqBody = {
            ...body,
            ...{
                pageSize: 1000,
                pageToken: body.pageToken,
                fields: 'nextPageToken, files(id, name, kind)',
                q: `'${folderId}' in parents and mimeType = 'image/jpeg'`
            }
        }
        console.log(reqBody)
        let res = await driveService
            .files
            .list(reqBody);

        const filesInFolder = res.data.files;
        console.log("Files Where Retrieved starting download");
        if (!externalDriveDirectory.includes(folderName)) {
            await downloadPhotos(filesInFolder, folderName, driveService);
            console.log("Setting up folder in surplus storage drive : " + folderName)
            let externalDriveFolder = await setupExternalDriveFolder(folderName);
            console.log("Folder was setup in surplus storage drive : " + folderName);
            console.log("==================================")
            console.log("Starting : ProcessPhotos");
            await processPhotos(externalDriveFolder);
            if (res.data.nextPageToken) {
                console.log("Continuing to download files in folder: " + folderName);
                console.log("pageToken: " + res.data.nextPageToken);
                console.log(res.data)
                await downloadAndProcessAllPhotosFromFolder(folders, externalDriveDirectory, driveService, {pageToken: res.data.nextPageToken});
            }

        } else {
            console.log(`Folder: ${folderName} already exists on external drive`)
        }

        await driveCleanUp(createdTime, driveService, filesInFolder);

    }
}


async function main(body = {}) {
    console.log("Surplus Warehouse Photo Downloader")
    console.log("==================================")
    console.log("")
    console.log("Written by: Michael Walker")
    console.log("Email: mwalker@sigmaequipmnent.com")
    console.log("")
    console.log("This program will download all the photos from the Surplus Warehouse Google Drive")
    console.log("")
    console.log("Date: 01/29/2024")
    console.log("Version: 1.0.0")
    console.log("==================================")

    let driveService = getDriveService();
    let externalDriveDirectory = fs.readdirSync(path.join(externalDrive));


    console.log("Getting All Folders in Surplus Warehouse Folder ( Google Drive )");
    let res = await driveService
        .files
        .list({
            ...body,
            ...{
                fields: 'nextPageToken, files(id, name, kind, createdTime)',
                q: `'${surplusProcurementFolderID}' in parents and mimeType = 'application/vnd.google-apps.folder'`
            }
        });

    const folders = res.data.files;

    console.log("Got all folders in the Surplus Warehouse Folder ( Google Drive ) complete");
    console.log("==================================")
    await downloadAndProcessAllPhotosFromFolder(folders, externalDriveDirectory, driveService)

    console.log("Cleaning up photos ( Surplus Storage )")
    surplusStorageCleanUp();
    console.log("Finished cleaning up photos ( Surplus Storage )")

    console.log("==================================")
    console.log("Finished downloading all files in all folders");
    console.log("==================================")

}

main()
    .catch(console.error)



