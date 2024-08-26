const express = require("express");
const axios = require("axios");
const readingTime = require("reading-time");
const cheerio = require("cheerio");
const bodyParser = require("body-parser");
const pdf2html = require("pdf2html");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const path = require("node:path");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = "https://bydfquuagkdbpkiarjwb.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "../public")));

const upload = multer({ storage: multer.memoryStorage() });
const UPLOAD_BUCKET = "uploads";

// Utility functions
async function loadArticles() {
  const { data, error } = await supabase.from("articles").select("*");
  if (error) console.error("Error loading articles:", error);
  return data;
}

async function deleteArticle(id) {
  const { data, error } = await supabase.from("articles").delete().eq("id", id);
  if (error) {
    console.error("Error deleting article:", error);
    return false;
  }
  return data;
}

async function saveArticles(articles) {
  const { data, error } = await supabase.from("articles").upsert(articles);
  if (error) {
    console.error("Error saving articles:", error);
    return null;
  }
  return data;
}

function generateID() {
  const now = new Date();
  return `${now.toISOString().replace(/\D/g, "").slice(0, 17)}${Math.floor(100000 + Math.random() * 900000)}`;
}

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

app.get("/articles/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "article.html"));
});

app.get("/uploads/:filename", async (req, res) => {
  const { filename } = req.params;
  const { data, error } = supabase.storage
    .from(UPLOAD_BUCKET)
    .getPublicUrl(filename);
  if (error) {
    console.error("Error creating signed URL:", error);
    return res.status(500).send("Error retrieving file.");
  }
  res.redirect(data.publicUrl);
});

app.get("/api/articles", async (req, res) => {
  let articles = await loadArticles();
  const { sort, archived, reverse } = req.query;
  if (sort) {
    articles.sort((b, a) =>
      reverse === "true"
        ? b[sort].localeCompare(a[sort])
        : a[sort].localeCompare(b[sort]),
    );
  } else {
    articles.sort((b, a) => b.id - a.id);
  }
  if (archived === "true") {
    articles = articles.filter((article) => !article.archived);
  }
  res.json(articles);
});

app.post(
  "/api/articles/upload",
  upload.single("articleSource"),
  async (req, res) => {
    const { title } = req.body;
    const file = req.file;
    if (!file) return res.status(400).send("No file uploaded.");

    const filename = `${generateID()}_${file.originalname}`;
    const { data, error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .upload(filename, file.buffer, { contentType: file.mimetype });

    if (error) {
      console.error("Error uploading file to Supabase:", error);
      return res.status(500).send("Error uploading file.");
    }

    res
      .status(200)
      .json({ message: "File uploaded successfully", url: filename, title });
  },
);

async function getText(article) {
  if (
    article.source.startsWith("http://") ||
    article.source.startsWith("https://")
  ) {
    const { data } = await axios.get(article.source);
    return cheerio.load(data)("body").text();
  } else {
    const { data, error } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .getPublicUrl(article.source);
    if (error) throw new Error("Could not retrieve article content.");

    const response = await fetch(data.publicUrl);
    return (await response.blob()).text();
  }
}

app.post("/api/articles", async (req, res) => {
  const articles = await loadArticles();
  const newArticle = {
    ...req.body,
    id: generateID(),
    date: new Date().toISOString(),
  };

  newArticle.read = readingTime(await getText(newArticle));
  articles.push(newArticle);
  saveArticles(articles);

  res.status(201).json(newArticle);
});

app.get("/api/articles/tags", async (req, res) => {
  try {
    const articles = await loadArticles();
    if (!articles || articles.length === 0) {
      return res.status(404).json({ error: "No articles found" });
    }

    let tags = [];
    for (const article of articles) {
      if (article.tags) {
        tags = tags.concat(article.tags);
      }
    }

    const uniqueTags = [...new Set(tags)];
    res.json(uniqueTags);
  } catch (error) {
    console.error("Error retrieving tags:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.put("/api/articles/:id", async (req, res) => {
  const articles = await loadArticles();
  const articleIndex = articles.findIndex(
    (article) => article.id === req.params.id,
  );
  if (articleIndex >= 0) {
    const updatedArticle = { ...req.body, id: req.params.id };
    articles[articleIndex] = updatedArticle;
    saveArticles(articles);
    res.json(updatedArticle);
  } else {
    res.status(404).json({ error: "Article not found" });
  }
});

app.get("/api/articles/:id", async (req, res) => {
  const articles = await loadArticles();
  const article = articles.find((article) => article.id === req.params.id);
  article
    ? res.json(article)
    : res.status(404).json({ error: "Article not found" });
});

app.delete("/api/articles/:id", async (req, res) => {
  const result = await deleteArticle(req.params.id);
  res.status(204).json(result);
});

app.get("/articles/:id/markdown", async (req, res) => {
  try {
    const { page = 1, pageSize = 10000 } = req.query;
    const articles = await loadArticles();
    const article = articles.find((article) => article.id === req.params.id);

    if (!article) return res.status(404).send("Article not found");

    let html;
    if (article.markdown) {
      html = article.markdown;
    } else if (article.source.endsWith(".pdf") || article.fileType === "PDF") {
      const source = article.source.startsWith("http")
        ? article.source
        : supabase.storage
            .from(UPLOAD_BUCKET)
            .getPublicUrl(article.source.substring(8)).data.publicUrl;
      html = await pdf2html.html(source);
    } else {
      html = (await getReadability(article.source)).content;
    }

    article.markdown = html;
    saveArticles(articles);

    const start = (page - 1) * pageSize;
    res.json({
      page: Number(page),
      pageSize: Number(pageSize),
      totalPages: Math.ceil(html.length / pageSize),
      content: html.slice(start, start + pageSize),
    });
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/articles/:id/readability", async (req, res) => {
  const articles = await loadArticles();
  const article = articles.find((article) => article.id === req.params.id);
  article
    ? res.json(await getReadability(article.source))
    : res.status(404).json({ error: "Article not found" });
});

async function getReadability(source) {
  const { data } = await axios.get(source);
  return new Readability(
    new JSDOM(data, { url: source }).window.document,
  ).parse();
}

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "../", "favicon.ico"));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
