const {google} = require('googleapis');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises')
const Jimp = require('jimp');
const convert = require('heic-convert');
require('dotenv').config()

const {sep} = path;
const surplusProcurementFolderID = "1TeXMYU9jzWZyna7zB8jngeirvhJosvdO"
const externalDrive = `${sep}${process.env.EXTERNAL_DIRECTORY}${sep}surplus_storage${sep}warehouse${sep}`;

console.log("External Drive: " + externalDrive);

const oneHundredAndEightyDays = 15552000000;
const oneYear = 31536000000;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function surplusStorageCleanUp() {
    console.log("Cleaning up photos ( Surplus Storage )")
    let photosDirectory = path.join(externalDrive);
    let files = fs.readdirSync(photosDirectory);
    let oneYearAgo = Date.now() - oneYear;
    for (let i = 0; i < files.length; i++) {
        let file = files[i];
        let filePath = path.join(photosDirectory, file);
        let fileStats = fs.statSync(filePath);
        if (fileStats.birthtimeMs < oneYearAgo) {
            console.log(`Deleting file: ${file}`);
            fs.unlinkSync(filePath);
            console.log(`Finished deleting file: ${file}`);
        }
    }
    console.log("Finished cleaning up photos ( Surplus Storage )")
}

const getDriveService = () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'cert.json'),
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    return google.drive({version: 'v3', auth});
}

function progressBar(percent, text = "") {
    const dots = "*".repeat(percent / 5)
    const left = 20 - percent / 5
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
        let progress = Math.floor((i / files.length) * 100);
        progressBar(progress, `Compressing photo: ${file}`);
        if(!filePath.includes(".jpg") && !filePath.includes(".jpeg")) {
            if(filePath.includes(".heic")) {
                progressBar(progress, `Converting photo: ${file} to jpg`);
                let heicBuffer = await fsp.readFile(filePath);
                let jpgBuffer = await convert({
                    buffer: heicBuffer,
                    format: 'JPEG'
                });
                fs.unlinkSync(filePath);
                filePath = filePath.replace(".heic", ".jpg");
                await fsp.writeFile(filePath, jpgBuffer);
                await compressPhoto(filePath, path.join(externalDriveFolder, file.replace(".heic", ".jpg")) );
                progressBar(progress, `Finished compressing photo: ${file}`)
                continue;
            } else {
                console.log(`File: ${file} is not a photo or unexpected file type. Skipping...`);
                continue;
            }
        }
        await compressPhoto(filePath, path.join(externalDriveFolder, file));
        progressBar(progress, `Finished compressing photo: ${file}`)
    }
    progressBar(
        100,
        `Finished compressing all photos in folder: ${photosDirectory}`
    )
    console.log("==================================")

    console.log("Cleaning up photos ( Local )")
    files = fs.readdirSync(photosDirectory);
    await tempFilesCleanUp(files, photosDirectory);
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
    if (Date.now() - new Date(createdTime).getTime() > oneHundredAndEightyDays) {
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
        console.log("==================================")
    }
}

async function tempFilesCleanUp(files, photosDirectory) {
    console.log("Starting : tempFilesCleanUp");
    console.log("==================================")
    console.log("Cleaning up photos ( temp ) progress")
    progressBar(0, `Cleaning up photos ( temp ) progress`)
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
        `Finished cleaning up photos ( temp )`
    )
    console.log("==================================")
}

async function downloadPhotos(filesInFolder, folderName, driveService, body = {}) {
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
                .get({
                    ...body, ...{
                        fileId: fileId,
                        alt: 'media'
                    }
                }, {responseType: 'stream'})
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

async function downloadAndProcessAllPhotosFromFolder(folder, externalDriveDirectory, driveService, body = {}) {
    console.log("Starting : DownloadAndProcessAllPhotosFromFolder");
    console.log("==================================")
    const {id: folderId, name: folderName, createdTime} = folder;
    console.log(`Getting all files in folder: ${folderName}`);
    let folderBody = {
        pageSize: 1000,
        fields: 'nextPageToken, files(id, name, kind, modifiedTime, createdTime)',
        q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder'`
    }
    let res = await driveService
        .files
        .list(folderBody);
    const foldersInFolders = res.data.files;

    const photoFolders = foldersInFolders.find(folder => folder.name.includes("Photos"));
    if(!photoFolders) {
        console.log("No photos folder found in folder: " + folderName);
        return;
    }
    const { id: photoFolderId, modifiedTime } = photoFolders;

    if (Date.now() - new Date(modifiedTime).getTime() < 259200000) {
        console.log("Folder is too new to download photos");
        console.log("==================================")
        return;
    }

    const photosBody = {
        ...body,
        ...{
            pageSize: 1000,
            pageToken: body.pageToken,
            fields: 'nextPageToken, files(id, name, kind)',
            q: `'${photoFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder'`
        }
    }

    let photosRes = await driveService
        .files
        .list(photosBody);

    const filesInFolder = photosRes.data.files;

    if(!filesInFolder.length || filesInFolder.length === 0) {
        console.log("No photos found in folder: " + folderName);
        return;
    }
    console.log("Files Where Retrieved starting download");

    if (!externalDriveDirectory.includes(folderName)) {
        await downloadPhotos(filesInFolder, folderName, driveService);
        console.log("Setting up folder in surplus storage drive : " + folderName)
        let externalDriveFolder = await setupExternalDriveFolder(folderName);
        console.log("Folder was setup in surplus storage drive : " + folderName);
        console.log("==================================")
        console.log("Starting : ProcessPhotos");
        await processPhotos(externalDriveFolder);
        if (photosRes.data.nextPageToken) {
            console.log("Continuing to download files in folder: " + folderName);
            console.log("pageToken: " + photosRes.data.nextPageToken);
            console.log(photosRes.data)
            await downloadAndProcessAllPhotosFromFolder(folder, externalDriveDirectory, driveService, {pageToken: photosRes.data.nextPageToken});
        }else{
            console.log("Finished downloading all files in folder: " + folderName);
            console.log("==================================")
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
    console.log(externalDriveDirectory)
    for (let i = 0 ; i < folders.length; i++) {
        let folder = folders[i];
        // Check to see if the folder is in the external drive
        if (externalDriveDirectory.map(f => f.trim()).includes(folder.name.trim())) {
            console.log("Folder: " + folder.name + " is already in the external drive");
            console.log("==================================")
            continue;
        }
        await downloadAndProcessAllPhotosFromFolder(folders[i], externalDriveDirectory, driveService)
    }

    console.log("Cleaning up photos ( Surplus Storage )")
    surplusStorageCleanUp();
    console.log("Finished cleaning up photos ( Surplus Storage )")

    console.log("==================================")
    console.log("Finished downloading all files in all folders");
    console.log("==================================")

}

main()
    .catch(console.error)



