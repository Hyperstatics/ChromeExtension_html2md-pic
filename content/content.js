// 内容脚本：提取网页文章内容

// 标记脚本已加载
console.log('[Web2Md] Content script loaded on:', window.location.href);

// 检查依赖库是否加载
if (typeof Readability === 'undefined') {
  console.error('[Web2Md] Readability.js not loaded!');
}
if (typeof TurndownService === 'undefined') {
  console.error('[Web2Md] Turndown.js not loaded!');
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Web2Md] Received message:', request);

  if (request.action === 'extractArticle') {
    console.log('[Web2Md] 开始提取文章...');

    // 检查依赖库
    if (typeof Readability === 'undefined') {
      console.error('[Web2Md] Readability.js 未加载!');
      sendResponse({
        success: false,
        error: '依赖库 Readability 未加载，请刷新页面后重试'
      });
      return false;
    }
    if (typeof TurndownService === 'undefined') {
      console.error('[Web2Md] Turndown.js 未加载!');
      sendResponse({
        success: false,
        error: '依赖库 Turndown 未加载，请刷新页面后重试'
      });
      return false;
    }

    try {
      console.log('[Web2Md] 调用 extractArticle()...');
      const data = extractArticle();
      console.log('[Web2Md] Article extracted successfully, markdown length:', data.markdown?.length);
      console.log('[Web2Md] Article title:', data.title);
      sendResponse({ success: true, data });
    } catch (error) {
      console.error('[Web2Md] Extract error:', error);
      sendResponse({ success: false, error: error.message });
    }
    return false; // 同步处理，不需要保持通道
  }
});

/**
 * 提取文章主体内容
 * 使用 Readability.js 解析文章，然后转换为 Markdown
 */
function extractArticle() {
  try {
    // 克隆文档以避免修改原始页面
    const documentClone = document.cloneNode(true);
    
    // 使用 Readability 解析文章
    const reader = new Readability(documentClone);
    const article = reader.parse();
    
    if (!article) {
      throw new Error('无法识别文章主体内容');
    }
    
    // 将文章内容转换为 Markdown
    const markdown = convertToMarkdown(article.content);
    
    // 提取图片 URL 列表（用于第二阶段）
    const images = extractImageUrls(article.content);
    
    return {
      title: article.title,
      author: article.byline || extractAuthor(),
      content: article.content,
      markdown: markdown,
      images: images,
      url: window.location.href,
      excerpt: article.excerpt,
      publishTime: extractPublishTime()
    };
  } catch (error) {
    console.error('提取文章失败:', error);
    throw error;
  }
}

/**
 * 使用 Turndown 将 HTML 转换为 Markdown
 */
function convertToMarkdown(html) {
  // 配置 Turndown
  const turndownService = new TurndownService({
    headingStyle: 'atx',        // 使用 # 风格的标题
    bulletListMarker: '-',      // 使用 - 作为列表标记
    codeBlockStyle: 'fenced',   // 使用代码块围栏
    fence: '```',               // 代码块使用 ```
    emDelimiter: '*',           // 斜体使用 *
    strongDelimiter: '**',      // 粗体使用 **
    linkStyle: 'inlined',       // 链接使用行内风格
    linkReferenceStyle: 'full'  // 链接引用使用完整风格
  });
  
  // 添加自定义规则：处理代码块
  turndownService.addRule('codeBlocks', {
    filter: ['pre'],
    replacement: function(content, node) {
      // 尝试获取语言类名
      const codeElement = node.querySelector('code');
      let language = '';
      if (codeElement) {
        const className = codeElement.className || '';
        const match = className.match(/language-(\w+)/);
        if (match) {
          language = match[1];
        }
      }
      return '\n\n```' + language + '\n' + content + '\n```\n\n';
    }
  });
  
  // 添加自定义规则：保留图片（第二阶段会处理下载）
  turndownService.addRule('images', {
    filter: 'img',
    replacement: function(content, node) {
      const alt = node.alt || '';
      const src = node.getAttribute('src') || '';
      // 将相对 URL 转为绝对 URL
      const absoluteSrc = new URL(src, window.location.href).href;
      return '![' + alt + '](' + absoluteSrc + ')';
    }
  });
  
  // 转换 HTML 为 Markdown
  return turndownService.turndown(html);
}

/**
 * 从 HTML 中提取图片 URL 列表
 */
function extractImageUrls(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const images = [];
  
  doc.querySelectorAll('img').forEach((img, index) => {
    const src = img.getAttribute('src');
    if (src) {
      // 转为绝对 URL
      const absoluteSrc = new URL(src, window.location.href).href;
      images.push({
        index: index + 1,
        originalUrl: absoluteSrc,
        alt: img.alt || ''
      });
    }
  });
  
  return images;
}

/**
 * 尝试从页面中提取作者信息
 */
function extractAuthor() {
  // 常见的作者选择器
  const authorSelectors = [
    'meta[name="author"]',
    '[class*="author"]',
    '[class*="byline"]',
    '.post-author',
    '.article-author',
    '[rel="author"]'
  ];
  
  for (const selector of authorSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      // 如果是 meta 标签
      if (element.tagName.toLowerCase() === 'meta') {
        return element.getAttribute('content');
      }
      return element.textContent.trim();
    }
  }
  
  return null;
}

/**
 * 尝试提取发布时间
 */
function extractPublishTime() {
  // 常见的时间选择器
  const timeSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="publishdate"]',
    'time[datetime]',
    '[class*="publish"]',
    '[class*="date"]'
  ];
  
  for (const selector of timeSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      if (element.tagName.toLowerCase() === 'meta') {
        return element.getAttribute('content');
      }
      if (element.tagName.toLowerCase() === 'time') {
        return element.getAttribute('datetime') || element.textContent.trim();
      }
      return element.textContent.trim();
    }
  }
  
  return null;
}