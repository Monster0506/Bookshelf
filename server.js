const express = require("express");
const axios = require("axios");
const readingTime = require("reading-time");
const cheerio = require("cheerio");
const bodyParser = require("body-parser");
const pdf2html = require("pdf2html");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "articles.json");

app.use(bodyParser.json());
app.use(express.static("public"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${generateID()}-${file.originalname}`);
  },
});
const upload = multer({ storage: storage });

const loadArticles = () => {
  if (fs.existsSync(DATA_FILE)) {
    const data = fs.readFileSync(DATA_FILE);
    return JSON.parse(data);
  }
  return [];
};

const saveArticles = (articles) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(articles, null, 2));
};

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/articles/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "article.html"));
});

app.get("/uploads/:filename", (req, res) => {
  res.sendFile(path.join(__dirname, "uploads", req.params.filename));
});

app.get("/api/articles", (req, res) => {
  let articles = loadArticles();
  const sort = req.query.sort;
  const archived = req.query.archived === "true";
  const invert = req.query.reverse === "true";

  if (sort) {
    articles.sort((b, a) => {
      if (sort === "id") {
        return invert ? b.id - a.id : a.id - b.id;
      }
      return invert
        ? b[sort].localeCompare(a[sort])
        : a[sort].localeCompare(b[sort]);
    });
  } else {
    articles.sort((a, b) => b.id - a.id);
  }

  if (archived) {
    articles = articles.filter((article) => !article.archived);
  }

  res.json(articles);
});

app.post("/api/articles/upload", upload.single("articleSource"), (req, res) => {
  const { title } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).send("No file uploaded.");
  }

  res.status(200).json({
    message: "File uploaded successfully",
    url: file.filename,
    title: title,
  });
});

async function getText(article) {
  let text;
  const source = article.source;
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const { data } = await axios.get(source);
    const $ = cheerio.load(data);
    text = $("body").text();
  } else {
    text = fs.readFileSync(path.join(__dirname, source), "utf8");
  }
  return text;
}

app.post("/api/articles", async (req, res) => {
  let articles = loadArticles();
  const newArticle = req.body;
  newArticle.id = generateID();
  newArticle.date = new Date().toISOString();

  const text = await getText(newArticle);
  const read = readingTime(text);
  newArticle.read = read;
  articles.push(newArticle);

  saveArticles(articles);

  res.status(201).json(newArticle);
});

app.put("/api/articles/:id", (req, res) => {
  const articles = loadArticles();
  const updatedArticle = req.body;
  const articleIndex = articles.findIndex(
    (article) => article.id === req.params.id,
  );
  if (articleIndex >= 0) {
    updatedArticle.id = req.params.id; // Ensure ID is preserved
    articles[articleIndex] = updatedArticle;
    saveArticles(articles);
    res.json(updatedArticle);
  } else {
    res.status(404).json({ error: "Article not found" });
  }
});

app.get("/api/articles/:id", (req, res) => {
  const articles = loadArticles();
  const article = articles.find((article) => article.id === req.params.id);
  if (article) {
    return res.json(article);
  }
  res.status(404).json({ error: "Article not found" });
});

app.delete("/api/articles/:id", (req, res) => {
  let articles = loadArticles();
  res.json(req.params.id);
  articles = articles.filter((article) => article.id !== req.params.id);
  saveArticles(articles);
  res.status(204).end();
});

app.get("/api/articles/tags", (req, res) => {
  const articles = loadArticles();
  res.json(loadArticles);
  let tags = ["TAGS"];
  for (const article of articles) {
    tags = tags.concat(article.tags || []);
  }
  res.json([...new Set(tags)]);
});

app.get("/articles/:id/markdown", async (req, res) => {
  const articles = loadArticles();
  const article = articles.find((article) => article.id === req.params.id);
  let html;
  if (article.markdown) {
    html = article.markdown;
  } else if (article.source.endsWith(".pdf") || article.fileType === "PDF") {
    html = await pdf2html.html(article.source);
  } else {
    const data = await fetch(
      `https://urltomarkdown.herokuapp.com/?url=${article.source}`,
    );
    const markdown = await data.text();
    html = markdownToHtml(markdown);
  }
  article.markdown = html;
  articles[articles.findIndex((article) => article.id === req.params.id)] =
    article;
  saveArticles(articles);

  res.send(html);
});

function markdownToHtml(input) {
  let markdown = input;
  // Convert headers
  markdown = markdown.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  markdown = markdown.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  markdown = markdown.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  markdown = markdown.replace(/^\n*(.*?)\n[-]{3,}/gm, "<h2>$1</h2>"); // For h2
  markdown = markdown.replace(/^\s*([-*]){3,}\s*$/gm, "<hr>");

  // Convert links
  markdown = markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1">',
  );
  markdown = markdown.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // Convert bold text
  markdown = markdown.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Convert italic text
  markdown = markdown.replace(/\_(.+?)\_/g, "<em>$1</em>");

  // Other stuff
  markdown = markdown.replace(
    /```([^\n]*\n)?([\s\S]*?)```/g,
    "<pre><code>$2</code></pre>",
  );
  markdown = markdown.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Convert blockquotes
  markdown = markdown.replace(/.*>\s*(.*)$/gm, "<blockquote>$1</blockquote>");

  // Convert unordered lists
  markdown = markdown.replace(/^\s*-\s+(.*)$/gm, "<ul>\n<li>$1</li>\n</ul>");
  // markdown = markdown.replace(/<\/ul>\n<ul>/g, ""); // Merge consecutive <ul> tags
  markdown = markdown.replace(
    /^\s*\d+\.\s+(.*)$/gm,
    "<ol>\n<li>$1</li>\n</ol>",
  );
  markdown = markdown.replace(/<\/ol>\n<ol>/g, ""); // Merge consecutive <ol> tags

  // Convert new lines to <p> tags
  markdown = markdown.replace(/\n\n/g, "</p><p>");
  markdown = `<p>${markdown}</p>`;

  return markdown;
}

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "favicon.ico"));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

function generateID() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const milliseconds = String(now.getMilliseconds()).padStart(3, "0");

  const randomNumber = String(Math.floor(100000 + Math.random() * 900000));

  return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}${
    randomNumber
  }`;
}
