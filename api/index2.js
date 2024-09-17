const express = require("express");
const summarize = require("super-sum");
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
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3861;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

const authenticateUser = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1]; // Get the token from 'Bearer <token>'
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = jwt.verify(token, SUPABASE_JWT_SECRET);
    req.user = user;
    next();
  } catch (error) {
    console.error("Error verifying token:", error);
    return res.status(401).json({ error: "Unauthorized" });
  }
};

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
  const { data: article, error: fetchError } = await supabase
    .from("articles")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError) {
    console.error("Error fetching article:", fetchError);
    return false;
  }

  const { data: trashData, error: insertError } = await supabase
    .from("trash")
    .insert([article]);

  if (insertError) {
    console.error("Error inserting article into trash:", insertError);
    return false;
  }

  const { data: deleteData, error: deleteError } = await supabase
    .from("articles")
    .delete()
    .eq("id", id);

  if (deleteError) {
    console.error("Error deleting article from articles:", deleteError);
    return false;
  }

  console.log("Article moved to trash successfully:", trashData);
  return trashData;
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
    articles.sort((b, a) => a.id - b.id);
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

async function getText(source) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const { data } = await axios.get(source);
    return cheerio.load(data)("body").text();
  }
  const { data, error } = supabase.storage
    .from(UPLOAD_BUCKET)
    .getPublicUrl(source);
  let publicUrl = data.publicUrl;
  if (publicUrl.includes("/uploads//uploads/")) {
    publicUrl = publicUrl.replace("/uploads//uploads/", "/uploads/");
  }
  if (error) throw new Error("Could not retrieve article content.");

  const response = await fetch(publicUrl);
  const response2 = await response.blob();
  return { text: await response2.text(), source: publicUrl };
}

app.post("/api/articles", async (req, res) => {
  const articles = await loadArticles();
  const newArticle = {
    ...req.body,
    id: generateID(),
    date: new Date().toISOString(),
  };

  newArticle.read = readingTime(await getText(newArticle.source).text);
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

app.get("/api/articles/readability", async (req, res) => {
  const source = req.query.source;

  if (!source) {
    return res.status(400).json({ error: "Source URL is required" });
  }

  try {
    const readabilityData = await getReadability(source);
    res.json(readabilityData);
  } catch (error) {
    console.error("Error fetching readability:", error);
    res.status(500).json({ error: "Failed to fetch readability data" });
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
    // Parse page and pageSize from query parameters, defaulting to 1 and 10000 respectively
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

    const currentPage = Number(page);
    const currentPageSize = Number(pageSize);

    // Calculate pagination
    const totalLength = html.length;
    const totalPages = Math.ceil(totalLength / currentPageSize);
    const start = (currentPage - 1) * currentPageSize;
    const end = Math.min(start + currentPageSize, totalLength);

    // Return paginated result
    res.json({
      page: currentPage,
      pageSize: currentPageSize,
      totalPages: totalPages,
      content: html.slice(start, end),
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

app.get("/articles/:id/summary", async (req, res) => {
  const sentences = Number(req.query.sentences) || 10;
  const articles = await loadArticles();
  const article = articles.find((article) => article.id === req.params.id);
  let summary = article.summary;
  if (article.summary && !article.summary) {
    summary = article.summary;
  } else {
    let item = await getReadability(article.source);
    console.log(item);
    let a = item.content;
    console.log("A: ", a);
    let content = a;
    content = content.replace(/<\/?[^>]+>/gi, "");

    const abstract = summarize({ corpus: content, nSentences: sentences });
    console.log(summary);

    summary = abstract.sentences;
  }
  article.summary = summary;
  saveArticles(articles);
  res.json(summary);
});

const populateDatalist = async () => {
  const response = await fetch("/api/articles", {
    method: "GET",
  });
  const articles = await response.json();
  for (const article of articles) {
    const option = document.createElement("option");
    option.value = article.title;
    datalist.appendChild(option);
  }
  populateDatalist2();
};
const populateDatalist2 = async () => {
  const allTags = await fetch("/api/articles/tags", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  setTimeout(async () => {
    const tags = await allTags.json();
    for (const tag of tags) {
      const option = document.createElement("option");
      option.value = tag;
      datalist.appendChild(option);
    }
  }, 1000);
};

async function getReadability(source) {
  console.log(source);
  const item = await getText(source);
  console.log(item);
  const { text, url } = item;

  return new Readability(new JSDOM(text, { url: url }).window.document).parse();
}

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "../", "favicon.ico"));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
module.exports = app;
