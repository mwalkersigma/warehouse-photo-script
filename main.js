const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const Jimp = require('jimp');

const {sep} = path;
const surplusProcurementFolderID = "1-BnROAnMCiylGBlBfiuonvSi3rxl4zk7"
const externalDrive = `${sep}${sep}10.100.100.10${sep}Surplus_Storage${sep}warehouse${sep}`;

const oneHunderedAndEightyDays = 15552000000;
const oneYear = 31536000000;


const getDriveService = () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'cert.json'),
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const driveService = google.drive({version: 'v3', auth});
    return driveService;
}

async function compressPhoto(filePath,outPath=undefined){
    let image = await Jimp.read(filePath);
    return await image
        ['resize'](768, Jimp.AUTO)
        .quality(85)
        .write( outPath || filePath );

}

async function setupExternalDriveFolder(folderName){
    let externalDriveFolder = path.join(externalDrive, folderName);
    if(!fs.existsSync(externalDriveFolder)){
        fs.mkdirSync(externalDriveFolder);
        return externalDriveFolder;
    }
    return externalDriveFolder + sep;
}



async function driveCleanUp(createdTime,driveService,filesInFolder){
    console.log(`Folder is ${Math.floor((Date.now() - new Date(createdTime).getTime()) / 86400000)} days old`);
    if(Date.now() - new Date(createdTime).getTime() > oneHunderedAndEightyDays){
        console.log("Deleting folder from Google Drive");
        for(let {id:fileId,name:photoName} of filesInFolder){
            console.log(`Deleting photo: ${photoName}`);
            await driveService
                .files
                .delete({fileId});
            console.log(`Finished deleting photo: ${photoName}`);

        }
        console.log("Finished deleting folder from Google Drive");
    }else{
        console.log("Folder is not old enough to delete");
        console.log("It is safe, for now.....");
    }
}





async function main(){
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
            fields: 'nextPageToken, files(id, name, kind, createdTime)',
            q: `'${surplusProcurementFolderID}' in parents and mimeType = 'application/vnd.google-apps.folder'`
        });

    console.log(res)
    const folders = res.data.files;
    console.log(folders);
    console.log("Got all folders in the Surplus Warehouse Folder ( Google Drive ) complete");

    for(let i = 0; i < folders.length; i++){
        const {id:folderId, name:folderName, createdTime } = folders[i];
        console.log(`Getting all files in folder: ${folderName}`);
        res = await driveService
            .files
            .list({

                fields: 'nextPageToken, files(id, name, kind)',
                q: `'${folderId}' in parents and mimeType = 'image/jpeg'`
            });
        const filesInFolder = res.data.files;
        if(!externalDriveDirectory.includes(folderName)){
            for(let j = 0; j < filesInFolder.length; j++){
                await new Promise((resolve, reject) => {
                    const {id:fileId, name:fileName} = filesInFolder[j];
                    console.log(`Downloading file: ${folderName} - ${fileName} - ${fileId}`);
                    res = driveService
                        .files
                        .get({
                            fileId: fileId,
                            alt: 'media'
                        }, {responseType: 'stream'})
                        .then(res => {
                            const dest = path.join(__dirname, '/photos',`${folderName}-${fileName}`);
                            const writeStream = fs.createWriteStream(dest);
                            res.data
                                .on('end', () => {
                                    console.log(`Downloaded file: ${folderName} ${fileName}`);
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

            console.log(`Finished downloading all files in folder: ${folderName}`);
            console.log("==================================")
            console.log("Processing photos")
            let photosDirectory = path.join(__dirname, '/photos');
            let files = fs.readdirSync(photosDirectory);

            for(let i = 0; i < files.length; i++){
                let file = files[i];
                let filePath = path.join(photosDirectory, file);
                let externalDriveFolder = await setupExternalDriveFolder(folderName);

                console.log(`Compressing photo: ${file} and sending to ${externalDriveFolder}`);
                await compressPhoto(filePath, path.join(externalDriveFolder, file));
                console.log(`Finished compressing photo: ${file}`);

            }

            console.log("Finished processing photos")
            console.log("==================================")
            console.log("Cleaning up photos ( Local )")
            for(let i = 0; i < files.length; i++) {
                let file = files[i];
                console.log(`Deleting file: ${file}`);
                let filePath = path.join(photosDirectory, file);
                fs.unlinkSync(filePath);
                console.log(`Finished deleting file: ${file}`);
            }
            console.log("Finished cleaning up photos ( Local )")
            console.log("==================================")
        }
        else{console.log(`Folder: ${folderName} already exists on external drive`)}


        await driveCleanUp(createdTime,driveService,filesInFolder);


    }
    console.log("Finished downloading all files in all folders");
    console.log("==================================")
}
main().catch(console.error)