const express = require("express");
const axios = require("axios");
const readingTime = require("reading-time");
const cheerio = require("cheerio");
const bodyParser = require("body-parser");
const pdf2html = require("pdf2html");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const { Readability } = require("@mozilla/readability");
const path = require("node:path");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const { create } = require("node:domain");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "articles.json");
const SUPABASE = "https://bydfquuagkdbpkiarjwb.supabase.co";
const anonKey = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE, anonKey);

app.use(bodyParser.json());
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage() });

const loadArticles = async () => {
  const { data, error } = await supabase.from("articles").select("*");

  if (error) {
    console.error("Error loading articles:", error);
  }

  return data;
};

const deleteArticle = async (id) => {
  const { data, error } = await supabase.from("articles").delete().eq("id", id);

  if (error) {
    console.error("Error deleting article:", error);
    return false;
  }

  return data;
};

const saveArticles = async (articles) => {
  const { data, error } = await supabase.from("articles").upsert(articles); // `upsert` will insert or update
  if (error) {
    console.error("Error saving articles:", error);
    return null;
  }
  return data;
};

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/articles/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "article.html"));
});

app.get("/uploads/:filename", async (req, res) => {
  const { filename } = req.params;
  const bucketName = "uploads";

  // Create a signed URL to download the file
  const { data, error } = supabase.storage
    .from(bucketName)
    .getPublicUrl(`${filename}`); // URL valid for 60 seconds

  if (error) {
    console.error("Error creating signed URL:", error);
    return res.status(500).send("Error retrieving file.");
  }

  res.redirect(data.publicUrl); // Redirect to the signed URL
});

app.get("/api/articles", async (req, res) => {
  let articles = await loadArticles();
  const sort = req.query.sort;
  const archived = req.query.archived === "true";
  const invert = req.query.reverse === "true";
  console.log(articles);

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

app.post(
  "/api/articles/upload",
  upload.single("articleSource"),
  async (req, res) => {
    const { title } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).send("No file uploaded.");
    }

    // Define your bucket name
    const bucketName = "uploads"; // Replace with your actual bucket name
    const id = generateID();
    const filename = `${id}_${file.originalname}`;

    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(`${filename}`, file.buffer, {
        contentType: file.mimetype,
      });

    if (error) {
      console.error("Error uploading file to Supabase:", error);
      return res.status(500).send("Error uploading file.");
    }
    res.status(200).json({
      message: "File uploaded successfully",
      url: `${filename}`,
      title: title,
    });
  },
);

async function getText(article) {
  let text;
  const source = article.source;
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const { data } = await axios.get(source);
    const $ = cheerio.load(data);
    text = $("body").text();
  } else {
    const bucketName = "uploads"; // Replace with your actual bucket name

    // Download the file from Supabase storage
    const { data, error } = await supabase.storage
      .from(bucketName)
      .getPublicUrl(`${source}`);

    if (error) {
      console.error("Error downloading file from Supabase:", error);
      throw new Error("Could not retrieve article content.");
    }

    // Convert the downloaded file (a Blob) to text
    const file = await fetch(data.publicUrl);
    const data2 = await file.blob();
    text = data2.text();
  }
  return text;
}

app.post("/api/articles", async (req, res) => {
  let articles = await loadArticles();
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

app.put("/api/articles/:id", async (req, res) => {
  const articles = await loadArticles();
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

app.get("/api/articles/:id", async (req, res) => {
  const articles = await loadArticles();
  const article = articles.find((article) => article.id === req.params.id);
  if (article) {
    return res.json(article);
  }
  res.status(404).json({ error: "Article not found" });
});

app.delete("/api/articles/:id", async (req, res) => {
  const result = await deleteArticle(req.params.id);
  res.status(204).json(result);
});

app.get("/api/articles/tags", async (req, res) => {
  const articles = await loadArticles();
  res.json(articles);
  let tags = ["TAGS"];
  for (const article of articles) {
    tags = tags.concat(article.tags || []);
  }
  res.json([...new Set(tags)]);
});

app.get("/articles/:id/markdown", async (req, res) => {
  const articles = await loadArticles();
  const article = articles.find((article) => article.id === req.params.id);
  let html;

  const markdown = article.markdown;
  if (markdown !== null) {
    html = article.markdown;
  } else if (article.source.endsWith(".pdf") || article.fileType === "PDF") {
    html = await pdf2html.html(article.source);
  } else {
    const readability = await getReadibility(article.source);
    html = readability.content; // Extracts the main content of the article
  }

  article.markdown = html;
  articles[articles.findIndex((article) => article.id === req.params.id)] =
    article;
  saveArticles(articles);

  res.send(html);
});

app.get("/articles/:id/readability", async (req, res) => {
  const articles = await loadArticles();
  const article = articles.find((article) => article.id === req.params.id);
  if (article) {
    const readability = await getReadibility(article.source);
    res.json(readability);
  }
});

async function getReadibility(source) {
  const { data } = await axios.get(source);
  const doc = new JSDOM(data, { url: source });
  const readability = new Readability(doc.window.document).parse();
  return readability;
}

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "favicon.ico"));
});

app.listen(PORT, () => {
  console.log(` Server is running on
    http : // localhost:${PORT}`);
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
