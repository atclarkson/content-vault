const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

require("dotenv").config();

let r2Client;
let r2Config;

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getR2Config() {
  if (r2Config) {
    return r2Config;
  }

  r2Config = {
    accountId: getRequiredEnv("R2_ACCOUNT_ID"),
    bucketName: getRequiredEnv("R2_BUCKET_NAME"),
    accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY"),
    publicUrl: getRequiredEnv("R2_PUBLIC_URL")
  };

  return r2Config;
}

function getR2Client() {
  if (r2Client) {
    return r2Client;
  }

  const config = getR2Config();

  r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  return r2Client;
}

function buildPublicUrl(baseUrl, key) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const normalizedKey = key.replace(/^\/+/, "");

  return `${normalizedBaseUrl}/${normalizedKey}`;
}

async function uploadFile(key, buffer, contentType) {
  const config = getR2Config();
  const client = getR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })
  );

  return buildPublicUrl(config.publicUrl, key);
}

async function deleteFile(key) {
  const config = getR2Config();
  const client = getR2Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: key
    })
  );
}

module.exports = {
  uploadFile,
  deleteFile
};
