// 全局变量存储提取的文章数据
let extractedArticle = null;
let isExtracting = false;

// DOM 元素
const savePathInput = document.getElementById('savePath');
const selectPathBtn = document.getElementById('selectPathBtn');
const saveBtn = document.getElementById('saveBtn');
const loadingSection = document.getElementById('loadingSection');
const loadingText = document.getElementById('loadingText');
const articleInfo = document.getElementById('articleInfo');
const articleTitle = document.getElementById('articleTitle');
const articleAuthor = document.getElementById('articleAuthor');
const imageCount = document.getElementById('imageCount');
const downloadOptions = document.getElementById('downloadOptions');
const downloadImagesCheckbox = document.getElementById('downloadImagesCheckbox');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// 默认保存子目录
const DEFAULT_SAVE_PATH = 'WebArticles';

// ==================== 初始化 ====================

// 初始化：加载保存的目录设置并自动提取文章
document.addEventListener('DOMContentLoaded', async () => {
  // 加载保存的路径设置
  const result = await chrome.storage.local.get(['savePath']);
  if (result.savePath) {
    savePathInput.value = result.savePath;
  } else {
    savePathInput.value = DEFAULT_SAVE_PATH;
    chrome.storage.local.set({ savePath: DEFAULT_SAVE_PATH });
  }

  // 自动提取文章内容
  await autoExtractArticle();
});

// ==================== 自动提取功能 ====================

/**
 * 自动提取文章内容
 * 在 popup 打开时自动执行
 */
async function autoExtractArticle() {
  if (isExtracting) return;
  isExtracting = true;

  console.log('[Web2Md] 开始自动提取文章...');

  try {
    // 显示加载动画
    showLoading(true, '正在提取文章内容...');

    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('[Web2Md] 当前标签页:', tab.url);

    // 检查是否是有效的网页
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      throw new Error('无法在浏览器内置页面上使用此插件');
    }

    // 先尝试注入 content script（如果页面之前没有加载过）
    try {
      console.log('[Web2Md] 正在注入 content script...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['lib/readability.js', 'lib/turndown.js', 'content/content.js']
      });
      console.log('[Web2Md] Content script 注入完成');
    } catch (e) {
      // 可能已经注入过了，忽略错误
      console.log('[Web2Md] 脚本可能已注入:', e.message);
    }

    // 发送消息给 content script 提取文章
    console.log('[Web2Md] 发送提取文章消息...');
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractArticle' });
    console.log('[Web2Md] 收到响应:', response);

    if (response && response.success) {
      extractedArticle = response.data;
      console.log('[Web2Md] 提取成功，文章标题:', extractedArticle.title);
      console.log('[Web2Md] Markdown内容长度:', extractedArticle.markdown?.length || 0);

      // 显示文章信息
      articleTitle.textContent = extractedArticle.title || '未知标题';
      articleAuthor.textContent = extractedArticle.author || '未知作者';
      imageCount.textContent = extractedArticle.images ? extractedArticle.images.length : 0;

      // 显示文章信息和下载选项
      articleInfo.style.display = 'block';
      if (extractedArticle.images && extractedArticle.images.length > 0) {
        downloadOptions.style.display = 'block';
      }

      // 启用保存按钮
      saveBtn.disabled = false;

      // 显示成功提示
      showToast('文章提取成功！', 'success');
    } else {
      console.error('[Web2Md] 提取失败:', response?.error);
      throw new Error((response && response.error) || '提取失败');
    }
  } catch (error) {
    console.error('自动提取失败:', error);
    showToast('提取失败: ' + error.message, 'error');
  } finally {
    showLoading(false);
    isExtracting = false;
  }
}

// ==================== 一键保存功能 ====================

/**
 * 一键保存按钮事件
 * 如果文章未提取，先自动提取再保存
 */
saveBtn.addEventListener('click', async () => {
  // 如果正在提取中，不执行
  if (isExtracting) {
    showToast('正在提取文章中，请稍候...', 'warning');
    return;
  }

  // 如果文章未提取，先自动提取
  if (!extractedArticle) {
    showToast('正在提取文章...', 'info');
    await autoExtractArticle();

    // 如果提取失败，不继续保存
    if (!extractedArticle) {
      return;
    }
  }

  // 执行保存操作
  await saveMarkdown();
});

/**
 * 保存 Markdown 文件
 */
async function saveMarkdown() {
  const savePath = savePathInput.value.trim();
  if (!savePath) {
    showToast('请设置保存子目录', 'error');
    return;
  }

  console.log('[Web2Md] 开始保存，文章数据:', extractedArticle);
  console.log('[Web2Md] Markdown内容长度:', extractedArticle.markdown?.length || 0);

  try {
    showProgress(true);
    updateProgressStep('extract');
    updateProgress(10, '准备保存...');

    // 生成文件名（使用文章标题）
    const baseFileName = sanitizeFileName(extractedArticle.title);
    const fileName = baseFileName + '.md';

    // 构建完整的相对路径（相对于下载目录）
    const fullPath = savePath + '/' + fileName;
    console.log('[Web2Md] 保存路径:', fullPath);

    // 判断是否下载图片
    const shouldDownloadImages = downloadImagesCheckbox && downloadImagesCheckbox.checked;
    let finalMarkdown = extractedArticle.markdown;

    if (shouldDownloadImages && extractedArticle.images && extractedArticle.images.length > 0) {
      updateProgressStep('download');
      updateProgress(30, `正在下载 ${extractedArticle.images.length} 张图片...`);

      // 创建图片文件夹名称
      const imageFolderName = baseFileName + '_images';
      const imageFolderPath = savePath + '/' + imageFolderName;

      // 调用 background script 下载图片
      const imageResponse = await chrome.runtime.sendMessage({
        action: 'downloadImages',
        data: {
          images: extractedArticle.images,
          savePath: imageFolderPath
        }
      });

      if (imageResponse.success) {
        // 更新 Markdown 中的图片链接为本地路径
        finalMarkdown = updateMarkdownImagePaths(
          extractedArticle.markdown,
          extractedArticle.images,
          imageFolderName
        );
        updateProgress(60, '图片下载完成，准备保存 Markdown...');
      } else {
        console.warn('图片下载失败:', imageResponse.error);
        showToast('图片下载失败，将保存原文链接', 'warning');
      }
    }

    updateProgressStep('save');
    updateProgress(80, '正在保存文件...');

    console.log('[Web2Md] 发送保存请求，内容长度:', finalMarkdown?.length || 0);

    // 调用 background script 保存文件
    const response = await chrome.runtime.sendMessage({
      action: 'saveMarkdown',
      data: {
        content: finalMarkdown,
        filePath: fullPath,
        fileName: fullPath
      }
    });

    console.log('[Web2Md] 保存响应:', response);

    if (response.success) {
      updateProgress(100, '保存完成！');
      showToast(`文件已保存到下载目录/${savePath}/`, 'success');

      setTimeout(() => {
        showProgress(false);
      }, 1500);
    } else {
      throw new Error(response.error || '保存失败');
    }
  } catch (error) {
    showProgress(false);
    showToast('保存失败: ' + error.message, 'error');
    console.error('保存错误:', error);
  }
}

// ==================== 路径设置 ====================

// 选择保存目录（使用 File System Access API）
selectPathBtn.addEventListener('click', async () => {
  try {
    // 检查浏览器是否支持 File System Access API
    if ('showDirectoryPicker' in window) {
      const dirHandle = await window.showDirectoryPicker();

      // 获取目录路径（使用目录名称作为子目录）
      const dirName = dirHandle.name;

      // 提示用户输入子目录名称（以所选文件夹名称为基础）
      const customPath = prompt(
        '请输入保存子目录名称（相对于 Chrome 下载目录）：',
        dirName
      );

      if (customPath !== null && customPath.trim() !== '') {
        const cleanPath = cleanSubPath(customPath.trim());
        savePathInput.value = cleanPath;
        chrome.storage.local.set({ savePath: cleanPath });
        showToast('保存目录已设置: ' + cleanPath, 'success');
      }
    } else {
      // 降级方案：手动输入
      const currentPath = savePathInput.value || DEFAULT_SAVE_PATH;
      const newPath = prompt(
        '您的浏览器不支持文件夹选择。\n请手动输入保存子目录（相对于下载目录）：',
        currentPath
      );

      if (newPath !== null && newPath.trim() !== '') {
        const cleanPath = cleanSubPath(newPath.trim());
        savePathInput.value = cleanPath;
        chrome.storage.local.set({ savePath: cleanPath });
        showToast('保存目录已设置: ' + cleanPath, 'success');
      }
    }
  } catch (error) {
    // 用户取消选择，不显示错误
    if (error.name === 'AbortError') {
      return;
    }
    console.error('选择目录失败:', error);
    showToast('选择目录失败: ' + error.message, 'error');
  }
});

/**
 * 清理子目录路径
 * @param {string} path - 原始路径
 * @returns {string} - 清理后的路径
 */
function cleanSubPath(path) {
  return path
    .replace(/^[\/\\]+/, '') // 移除开头的斜杠
    .replace(/[<>:"|?*]/g, '_') // 替换非法字符
    .replace(/\s+/g, '_') // 空格转为下划线
    .replace(/[\/\\]+/g, '/'); // 统一使用正斜杠
}

// ==================== Toast 通知系统 ====================

/**
 * 显示 Toast 通知
 * @param {string} message - 消息内容
 * @param {string} type - 类型: success, error, info, warning
 * @param {number} duration - 显示时长(毫秒)，默认3000
 */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');

  // 创建 Toast 元素
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  // 根据类型选择图标
  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️'
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close">×</button>
  `;

  // 关闭按钮事件
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => {
    hideToast(toast);
  });

  // 添加到容器
  container.appendChild(toast);

  // 自动隐藏
  if (duration > 0) {
    setTimeout(() => {
      hideToast(toast);
    }, duration);
  }
}

/**
 * 隐藏 Toast 通知
 * @param {HTMLElement} toast - Toast 元素
 */
function hideToast(toast) {
  if (!toast || toast.classList.contains('hiding')) return;

  toast.classList.add('hiding');
  toast.addEventListener('animationend', () => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  });
}

// ==================== 进度显示 ====================

/**
 * 显示/隐藏加载动画
 * @param {boolean} show - 是否显示
 * @param {string} text - 加载文本
 */
function showLoading(show, text = '加载中...') {
  loadingSection.style.display = show ? 'block' : 'none';
  loadingText.textContent = text;

  if (show) {
    articleInfo.style.display = 'none';
    downloadOptions.style.display = 'none';
    saveBtn.disabled = true;
  }
}

/**
 * 显示/隐藏进度条
 * @param {boolean} show - 是否显示
 */
function showProgress(show) {
  progressSection.style.display = show ? 'block' : 'none';
  if (!show) {
    progressFill.style.width = '0%';
    // 重置步骤状态
    document.querySelectorAll('.step').forEach(step => {
      step.classList.remove('active', 'completed');
    });
  }
}

/**
 * 更新进度
 * @param {number} percent - 进度百分比
 * @param {string} text - 进度文本
 */
function updateProgress(percent, text) {
  progressFill.style.width = percent + '%';
  progressText.textContent = text;
}

/**
 * 更新进度步骤
 * @param {string} stepName - 步骤名称: extract, download, save
 */
function updateProgressStep(stepName) {
  const steps = document.querySelectorAll('.step');
  const stepMap = { extract: 0, download: 1, save: 2 };
  const currentIndex = stepMap[stepName];

  steps.forEach((step, index) => {
    step.classList.remove('active');

    if (index < currentIndex) {
      // 已完成步骤
      step.classList.add('completed');
      step.querySelector('.step-icon').textContent = '✓';
    } else if (index === currentIndex) {
      // 当前步骤
      step.classList.add('active');
      // 恢复原始图标
      const icons = ['🔍', '📥', '💾'];
      step.querySelector('.step-icon').textContent = icons[index];
    } else {
      // 未开始步骤
      step.classList.remove('completed');
      const icons = ['🔍', '📥', '💾'];
      step.querySelector('.step-icon').textContent = icons[index];
    }
  });
}

// ==================== 工具函数 ====================

/**
 * 清理文件名中的非法字符
 * @param {string} fileName - 原始文件名
 * @returns {string} - 清理后的文件名
 */
function sanitizeFileName(fileName) {
  if (!fileName) return 'untitled';
  return fileName
    .replace(/[<>:\"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100) || 'untitled';
}

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
    const fileName = `image-${String(index + 1).padStart(3, '0')}.jpg`;
    const localPath = `./${imageFolderName}/${fileName}`;

    // 替换 Markdown 中的图片链接
    // 支持两种格式: ![alt](url) 和 <img src="url">
    const originalUrl = image.originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 替换 Markdown 格式的图片
    const mdPattern = new RegExp(`!\\[(.*?)\\]\\(${originalUrl}\\)`, 'g');
    updatedMarkdown = updatedMarkdown.replace(mdPattern, `![$1](${localPath})`);

    // 替换 HTML img 标签
    const htmlPattern = new RegExp(`<img[^>]*src=["']${originalUrl}["'][^>]*>`, 'g');
    updatedMarkdown = updatedMarkdown.replace(htmlPattern, (match) => {
      return match.replace(image.originalUrl, localPath);
    });
  });

  return updatedMarkdown;
}
