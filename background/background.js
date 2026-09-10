// 后台脚本：处理文件下载和其他后台任务

// 监听来自 popup 和 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveMarkdown') {
    saveMarkdownFile(request.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开启
  }
  
  if (request.action === 'downloadImages') {
    downloadImages(request.data)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

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
    
    // 使用 Chrome Downloads API 下载文件，并等待下载完成
    const downloadResult = await downloadAndWait({
      url: dataUrl,
      filename: relativeFileName,
      saveAs: false
    });

    if (!downloadResult.success) {
      throw new Error('下载失败: ' + downloadResult.error);
    }

    return { downloadId: downloadResult.downloadId, fileName };
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
    
    // 从 URL 提取文件扩展名，默认为 jpg
    const url = image.originalUrl;
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    let ext = '.jpg';
    const extMatch = pathname.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
    if (extMatch) {
      const foundExt = extMatch[1].toLowerCase();
      // 只允许常见的图片格式
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(foundExt)) {
        ext = '.' + foundExt;
        if (ext === '.jpeg') ext = '.jpg'; // 统一使用 jpg
      }
    }
    
    const fileName = `image-${String(i + 1).padStart(3, '0')}${ext}`;
    
    // 构建相对路径（Chrome downloads API 需要相对路径）
    const fullPath = relativeSavePath ? relativeSavePath + '/' + fileName : fileName;
    console.log(`[下载图片] 第 ${i + 1} 张图片路径:`, fullPath);
    
    try {
      const downloadResult = await downloadAndWait({
        url: image.originalUrl,
        filename: fullPath,
        saveAs: false
      });
      
      results.push({
        index: image.index,
        originalUrl: image.originalUrl,
        fileName: fileName,
        downloadId: downloadResult.downloadId,
        status: downloadResult.success ? 'success' : 'failed',
        error: downloadResult.error
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
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter(r => r.status === 'failed').length;
  
  return {
    total: images.length,
    success: successCount,
    failed: failedCount,
    results: results
  };
}

/**
 * 发起下载并等待完成
 *
 * 注册监听器必须先于调用 downloads.download。data URL（例如 Markdown）
 * 可能在返回下载 ID 前就完成，否则会错过 onChanged 事件。
 * @param {Object} options - Chrome Downloads API 的下载参数
 * @returns {Promise<{downloadId: number, success: boolean, error?: string}>}
 */
async function downloadAndWait(options) {
  let downloadId;
  let timeout;
  let settled = false;
  let resolveDownload;

  const downloadPromise = new Promise(resolve => {
    resolveDownload = resolve;
  });

  const cleanup = () => {
    clearTimeout(timeout);
    chrome.downloads.onChanged.removeListener(onChanged);
  };

  const finish = result => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveDownload(result);
  };

  function onChanged(delta) {
    if (downloadId === undefined || delta.id !== downloadId) return;

    if (delta.state && delta.state.current === 'complete') {
      finish({ success: true });
      return;
    }

    if (delta.error) {
      finish({ success: false, error: delta.error.current });
    }
  }

  // 先监听再发起下载，避免快速完成的 data URL 丢失完成事件。
  chrome.downloads.onChanged.addListener(onChanged);
  timeout = setTimeout(() => {
    finish({ success: false, error: '下载超时' });
  }, 30000); // 30秒超时

  try {
    downloadId = await chrome.downloads.download(options);

    // 兼容下载事件在 download() 返回前已经完成的情况。
    const [download] = await chrome.downloads.search({ id: downloadId });
    if (download?.state === 'complete') {
      finish({ success: true });
    } else if (download?.error) {
      finish({ success: false, error: download.error });
    }

    const result = await downloadPromise;
    return { downloadId, ...result };
  } catch (error) {
    cleanup();
    throw error;
  }
}

// 安装时的初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('网页转 Markdown 插件已安装');
});
