import cloudinary from "../config/cloudinary.js";
import logger from "../utils/logger.js";

const FOLDER = "exportconnect/products";

/**
 * Upload an image buffer to Cloudinary.
 * @param {Buffer} buffer - Image data
 * @param {string} [filename] - Optional filename for the public_id
 * @returns {Promise<{ secure_url: string, public_id: string }>}
 */
export async function uploadImage(buffer, filename) {
  const publicId = filename
    ? `${FOLDER}/${filename.replace(/\.[^.]+$/, "")}`
    : undefined;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: FOLDER,
        public_id: publicId,
        resource_type: "image",
        format: "jpg",
      },
      (error, result) => {
        if (error) {
          logger.error(`Cloudinary upload failed: ${error.message}`);
          return reject(new Error(`Image upload failed: ${error.message}`));
        }
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Delete a single image from Cloudinary by public_id.
 * @param {string} publicId
 * @returns {Promise<void>}
 */
export async function deleteImage(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
    logger.info(`Cloudinary image deleted: ${publicId}`);
  } catch (error) {
    logger.error(`Cloudinary delete failed for ${publicId}: ${error.message}`);
  }
}

/**
 * Delete multiple images from Cloudinary (best-effort).
 * @param {string[]} publicIds
 * @returns {Promise<void>}
 */
export async function deleteImages(publicIds) {
  if (!publicIds || publicIds.length === 0) return;
  for (const id of publicIds) {
    await deleteImage(id);
  }
}
