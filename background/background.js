// 后台脚本：处理文件下载和其他后台任务

// The popup submits the whole export before it can lose focus and close.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'saveArticle') return;
  saveArticle(request.data)
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});

async function saveArticle({ content, fileName, images, imageFolderName, imageFolderPath }) {
  const finalMarkdown = updateMarkdownImagePaths(content, images, imageFolderName);
  const markdown = await saveMarkdownFile({ content: finalMarkdown, fileName });
  const imageDownloads = await downloadImages({ images, savePath: imageFolderPath });
  return { markdown, images: imageDownloads };
}

function getImageFileName(image, index) {
  let ext = 'jpg';
  try {
    const match = new URL(image.originalUrl).pathname.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i);
    if (match) ext = match[1].toLowerCase().replace(/^jpeg$/, 'jpg');
  } catch {
    // Let the downloads API report invalid URLs per image without aborting the batch.
  }
  return `image-${String(index + 1).padStart(3, '0')}.${ext}`;
}

/**
 * 保存 Markdown 文件
 * @param {Object} data - 包含 content, filePath, fileName
 */
async function saveMarkdownFile(data) {
  const { content, fileName } = data;
  
  console.log('[保存文件] 原始文件名:', fileName);
  
  try {
    // 将内容转为 Data URL（service worker 中不能使用 URL.createObjectURL）
    // 使用 encodeURIComponent 直接编码，避免 base64 中文问题
    const dataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(content);
    
    // 将绝对路径转换为相对路径
    const relativeFileName = getRelativeDownloadPath(fileName);
    console.log('[保存文件] 转换后的相对路径:', relativeFileName);
    
    // Queue the download; Chrome owns its completion even after the popup closes.
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: relativeFileName,
      saveAs: false
    });

    return { downloadId, fileName };
  } catch (error) {
    console.error('保存 Markdown 文件失败:', error);
    throw error;
  }
}

/**
 * 将绝对路径转换为相对路径（相对于下载目录）
 * @param {string} absolutePath - 绝对路径
 * @returns {string} - 相对路径
 */
function getRelativeDownloadPath(absolutePath) {
  if (!absolutePath) return '';
  
  // 移除开头的斜杠（Unix 绝对路径）
  let relativePath = absolutePath.replace(/^\//, '');
  
  // 移除 Windows 盘符（如 C:\ 或 C:/）
  relativePath = relativePath.replace(/^[a-zA-Z]:[\\\/]/, '');
  
  // 清理路径中的非法字符（保留斜杠作为路径分隔符）
  relativePath = relativePath.replace(/[<>:"|?*]/g, '_');
  
  return relativePath;
}

/**
 * 批量下载图片
 * @param {Object} data - 包含 images（图片列表）, savePath（保存路径）
 */
async function downloadImages(data) {
  const { images, savePath } = data;
  const results = [];
  
  console.log('[下载图片] 原始 savePath:', savePath);
  
  // 将绝对路径转换为相对路径
  const relativeSavePath = getRelativeDownloadPath(savePath);
  console.log('[下载图片] 转换后的相对路径:', relativeSavePath);
  
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    
    const fileName = getImageFileName(image, i);

    // 构建相对路径（Chrome downloads API 需要相对路径）
    const fullPath = relativeSavePath ? relativeSavePath + '/' + fileName : fileName;
    console.log(`[下载图片] 第 ${i + 1} 张图片路径:`, fullPath);
    
    try {
      const downloadId = await chrome.downloads.download({
        url: image.originalUrl,
        filename: fullPath,
        saveAs: false
      });
      
      results.push({
        index: image.index,
        originalUrl: image.originalUrl,
        fileName: fileName,
        downloadId,
        status: 'queued'
      });
    } catch (error) {
      console.error(`下载图片 ${image.originalUrl} 失败:`, error);
      results.push({
        index: image.index,
        originalUrl: image.originalUrl,
        fileName: fileName,
        error: error.message,
        status: 'failed'
      });
    }
  }
  
  // 统计结果
  const queuedCount = results.filter(r => r.status === 'queued').length;
  const failedCount = results.filter(r => r.status === 'failed').length;
  
  return {
    total: images.length,
    queued: queuedCount,
    failed: failedCount,
    results: results
  };
}

// 安装时的初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('网页转 Markdown 插件已安装');
});

/**
 * 更新 Markdown 中的图片链接为本地路径
 * @param {string} markdown - 原始 Markdown 内容
 * @param {Array} images - 图片列表（包含 originalUrl）
 * @param {string} imageFolderName - 图片文件夹名称
 * @returns {string} 更新后的 Markdown
 */
function updateMarkdownImagePaths(markdown, images, imageFolderName) {
  let updatedMarkdown = markdown;

  images.forEach((image, index) => {
    // 生成本地图片文件名
    const fileName = getImageFileName(image, index);
    const localPath = `./${imageFolderName}/${fileName}`;

    // 替换 Markdown 中的图片链接
    // 支持两种格式: ![alt](url) 和 <img src="url">
    const originalUrl = image.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 替换 Markdown 格式的图片
    const mdPattern = new RegExp(`!\\[(.*?)\\]\\(${originalUrl}\\)`, 'g');
    updatedMarkdown = updatedMarkdown.replace(mdPattern, (_, alt) => `![${alt}](${localPath})`);

    // 替换 HTML img 标签
    const htmlPattern = new RegExp(`<img[^>]*src=["']${originalUrl}["'][^>]*>`, 'g');
    updatedMarkdown = updatedMarkdown.replace(htmlPattern, (match) => {
      return match.replace(image.originalUrl, () => localPath);
    });
  });

  return updatedMarkdown;
}
