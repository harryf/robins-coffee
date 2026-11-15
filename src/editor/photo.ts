// A photo made safe to publish, in the browser: drawn onto a canvas at no more than
// MAX_EDGE on the long side and saved as a new JPEG. The new file holds pixels only,
// so no EXIF, GPS or phone detail can travel with it. A test on every pull request
// checks committed photos again.
import { MAX_EDGE, JPEG_QUALITY } from "../moment";

export type CleanPhoto = { bytes: Uint8Array; width: number; height: number; url: string };

export async function cleanInBrowser(file: Blob): Promise<CleanPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const [width, height] = [Math.round(bitmap.width * scale), Math.round(bitmap.height * scale)];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("This photo could not be read."))), "image/jpeg", JPEG_QUALITY / 100));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, url: URL.createObjectURL(blob) };
}
