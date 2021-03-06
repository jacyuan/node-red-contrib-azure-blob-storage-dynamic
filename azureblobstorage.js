/*jshint esversion: 6 */
module.exports = function (RED) {

  var Client = require('azure-storage');
  var fs = require('fs');
  var path = require('path');
  var clientBlobService = null;
  var clientAccountName = "";
  var clientAccountKey = "";
  var clientContainerName = "";
  var clientBlobName = "";
  var node = null;
  var nodeConfig = null;

  var statusEnum = {
    disconnected: { color: "red", text: "Disconnected" },
    sending: { color: "green", text: "Sending" },
    sent: { color: "blue", text: "Sent message" },
    error: { color: "grey", text: "Error" },
    receiving: { color: "yellow", text: "Receiving" },
    received: { color: "green", text: "Received message" }
  };

  var setStatus = function (status) {
    node.status({ fill: status.color, shape: "dot", text: status.text });
  };

  var updateBlob = function (container, blob, file) {
    node.log('Updating Blob');
    //
  };

  var deleteBlob = function (container, blob) {
    node.log('deleting blob');
    clientBlobService.deleteBlob(container, blob, function (err, result, response) {
      if (err) {
        node.error('Error while trying to delete blob:' + err.toString());
        setStatus(statusEnum.error);
      } else {
        node.log('Blob deleted');
        setStatus(statusEnum.sent);
        node.send('Blob deleted');
      }
    });
  };

  var disconnectFrom = function () {
    if (clientBlobService) {
      node.log('Disconnecting from Azure');
      clientBlobService.removeAllListeners();
      clientBlobService = null;
      setStatus(statusEnum.disconnected);
    }
  };


  // Main function called by Node-RED
  function AzureBlobStorage(config) {
    // Store node for further use
    node = this;
    nodeConfig = config;

    node.credentials = node.credentials || {};

    // Create the Node-RED node
    RED.nodes.createNode(this, config);
    clientAccountName = getBlobAccountInfo(node.credentials, 'accountname');
    clientAccountKey = getBlobAccountInfo(node.credentials, 'key');

    var blobService = Client.createBlobService(clientAccountName, clientAccountKey);

    this.on('input', function (msg) {
      node.log("Uploading blob...");
      var messageJSON = null;

      clientContainerName = node.credentials.container || msg.containerName;
      clientBlobName = node.credentials.blob;

      if (!node.credentials.blob) {
        var nameObject = path.parse(msg.blobName);
        clientBlobName = nameObject.base;
      }

      // Sending data to Azure Blob Storage
      setStatus(statusEnum.sending);
      createContainer(clientContainerName, blobService, function () {
        uploadBlob(msg.payload, blobService, clientContainerName, clientBlobName, function () {
          node.log("Upload completed!");
          node.send(msg);
        });
      });
    });

    this.on('close', function () {
      disconnectFrom(this);
    });
  }

  function createContainer(containerName, blobservice, callback) {
    // Create the container
    blobservice.createContainerIfNotExists(containerName, function (error) {
      if (error) {
        node.log(error);
      }
      else {
        node.log("Container '" + containerName + "' ready for blob creation");
        callback();
      }
    });
  }

  function uploadBlob(file, blobService, containerName, blobName, callback) {
    blobService.createBlockBlobFromLocalFile(containerName, blobName, file, function (error) {
      if (error) {
        node.log(error);
      }
      else {
        node.log("Blob '" + blobName + "' uploaded in container '" + containerName + "'");
        callback();
      }
    });
  }

  function AzureBlobStorageDownload(config) {
    // Store node for further use
    node = this;
    nodeConfig = config;

    node.credentials = node.credentials || {};

    // Create the Node-RED node
    RED.nodes.createNode(this, config);
    clientAccountName = getBlobAccountInfo(node.credentials, 'accountname');
    clientAccountKey = getBlobAccountInfo(node.credentials, 'key');

    var blobservice = Client.createBlobService(clientAccountName, clientAccountKey);
    var destinationFile;

    this.on('input', function (msg) {
      clientContainerName = node.credentials.container || msg.containerName;
      clientBlobName = node.credentials.blob || msg.blobName;

      node.log('Downloading blob...');
      setStatus(statusEnum.receiving);

      node.log("msg.payload " + msg.payload);
      if (msg.payload) {
        destinationFile = msg.payload;
      }
      else {
        const fileName = clientBlobName.replace('.txt', '.downloaded.txt');
        destinationFile = path.join(__dirname, fileName);
      }

      node.log("destinationFile " + destinationFile);

      downloadBlob(blobservice, clientContainerName, clientBlobName, destinationFile, function () {
        node.log("Download completed!");
        node.send(msg);
      });
      setStatus(statusEnum.received);
    });

    this.on('close', function () {
      disconnectFrom(this);
    });
  }

  function downloadBlob(blobservice, containerName, blobName, fileName, callback) {
    blobservice.getBlobToLocalFile(containerName, blobName, fileName, function (error2) {
      if (error2) {
        node.log(error2);
      }
      else {
        node.log("Blob '" + blobName + "' is downloaded successfully at '" + path.dirname(fileName) + "'");
        callback();
      }
    });
  }

  function AzureBlobStorageDownloadToBufferObj(config) {
    // Store node for further use
    node = this;
    nodeConfig = config;

    node.credentials = node.credentials || {};

    // Create the Node-RED node
    RED.nodes.createNode(this, config);

    clientAccountName = getBlobAccountInfo(node.credentials, 'accountname');
    clientAccountKey = getBlobAccountInfo(node.credentials, 'key');

    var blobservice = Client.createBlobService(clientAccountName, clientAccountKey);

    this.on('input', function (msg, nodeSend, nodeDone) {
      clientContainerName = node.credentials.container || msg.containerName;
      clientBlobName = node.credentials.blob || msg.blobName;

      node.log('Downloading blob...');
      setStatus(statusEnum.receiving);

      var lines = Buffer.from([]);

      var rs = blobservice.createReadStream(clientContainerName, clientBlobName)
        .on('data', function (chunk) {
          lines = Buffer.concat([lines, chunk]);
        })
        .on('error', function (err) {
          node.error(err, msg);
          if (node.sendError) {
            var sendMessage = RED.util.cloneMessage(msg);
            delete sendMessage.payload;
            sendMessage.error = err;
            nodeSend(sendMessage);
          }
          nodeDone();
        })
        .on('end', function () {
          msg.payload = lines;
          nodeSend(msg);
        });

      setStatus(statusEnum.received);
    });

    this.on('close', function () {
      disconnectFrom(this);
    });
  }

  function getBlobAccountInfo(credentials, infoPropName) {
    // check and return value from the node credentials first
    if (credentials && credentials[infoPropName]) {
      return credentials[infoPropName];
    }

    // check and return value from the global CONFIG if exists
    if(CONFIG.blob_storage) {
      return CONFIG.blob_storage[infoPropName];
    }

    return undefined;
  }

  RED.nodes.registerType("Upload Blob", AzureBlobStorage, {
    credentials: {
      accountname: { type: "text" },
      key: { type: "text" },
      container: { type: "text" },
      blob: { type: "text" },
    },
    defaults: {
      name: { value: "Upload to Blob Storage" },
    }
  });

  RED.nodes.registerType("Download to file", AzureBlobStorageDownload, {
    credentials: {
      accountname: { type: "text" },
      key: { type: "text" },
      container: { type: "text" },
      blob: { type: "text" },
    },
    defaults: {
      name: { value: "Download to file" },
    }
  });

  RED.nodes.registerType("Download to buffer", AzureBlobStorageDownloadToBufferObj, {
    credentials: {
      accountname: { type: "text" },
      key: { type: "text" },
      container: { type: "text" },
      blob: { type: "text" },
    },
    defaults: {
      name: { value: "Download to buffer" },
    }
  });

  // Helper function to print results in the console
  function printResultFor(op) {
    return function printResult(err, res) {
      if (err) node.error(op + ' error: ' + err.toString());
      if (res) node.log(op + ' status: ' + res.constructor.name);
    };
  }
};