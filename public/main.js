document.addEventListener("DOMContentLoaded", () => {
  const articleGrid = document.getElementById("articleGrid");
  const searchBar = document.getElementById("searchBar");
  const fileTypes = document.getElementById("filetype");
  const datalist = document.getElementById("options");
  const archive = document.getElementById("archived");
  let invertFile = "";
  let invertReads = "false";
  let archived = "true";
  const reads = document.getElementById("read");
  const addArticleForm = document.getElementById("addArticleForm");
  const populateDatalist = async () => {
    const response = await fetch("/api/articles", {
      method: "GET",
    });
    const articles = await response.json();
    for (article of articles) {
      const option = document.createElement("option");
      option.value = article.title;
      datalist.appendChild(option);
    }
    console.log("breaks here");
    populateDatalist2();
  };
  const populateDatalist2 = async () => {
    const allTags = await fetch("/api/articles/tags", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    console.log(allTags);
    setTimeout(async () => {
      const tags = await allTags.json();
      for (tag of tags) {
        const option = document.createElement("option");
        option.value = tag;
        datalist.appendChild(option);
      }
      console.log("Nope");
    }, 1000);
  };
  // Load articles on page load
  const loadArticles = async () => {
    // const response = await fetch("/api/articles");
    const response = await fetch(`/api/articles?sort=id&archived=${archived}`);
    const articles = await response.json();
    renderArticles(articles);
  };
  reads.addEventListener("click", async () => {
    invertReads = invertReads === "true" ? "false" : "true";
    const type = "status";
    const response = await fetch(
      `/api/articles?sort=${type}&reverse=${invertReads}&archived=${archived}`,
    );
    const articles = await response.json();
    renderArticles(articles);
  });
  fileTypes.addEventListener("click", async () => {
    invertFile = invertFile === "fileType" ? "" : "fileType";
    const response = await fetch(
      `/api/articles?sort=${invertFile}&archived=${archived}`,
    );
    const articles = await response.json();
    renderArticles(articles);
  });
  archive.addEventListener("click", async () => {
    archived = archived === "true" ? "false" : "true";
    const response = await fetch(`/api/articles?archived=${archived}`);
    const articles = await response.json();
    renderArticles(articles);
  });

  // Render articles in the grid
  const renderArticles = (articles) => {
    articleGrid.innerHTML = "";
    for (const article of articles) {
      let articleClass = "unread";
      if (article.fileType !== "URL") {
        article.source = article.source.slice(29);
      } else {
        article.source = article.source.slice(8);
      }
      if (article.status === "read") {
        articleClass = "read";
      }
      if (article.archived) {
        article.status = `archived/${article.status}`;
      }
      const articleCard = document.createElement("div");
      articleCard.className = "col-lg-4 col-md-6 mb-4";

      let tags = "";
      const allTags = article.tags;
      if (allTags) {
        for (const tag of allTags) {
          tags += `<span class="badge custom-badge bg-info text-dark me-1">${tag}</span>`;
        }
      }

      articleCard.innerHTML = `
      <div class="${articleClass} card custom-card shadow-sm border-light rounded">
        <div class="card-body ">
          <h5 class="card-title">${article.title}</h5>
          <div class="badge-container mb-2">${tags}</div>
          <p class="card-text text-truncate" title="${article.source}">
            ${article.source}
          </p>
          <div class="badge-container mb-2">
            <span class="badge text-bg-primary">${article.fileType}</span>
            <span class="badge text-bg-secondary">${article.status}</span>
            <span class="badge text-bg-success">${article.read ? article.read.text : "Unknown"}</span>
          </div>
          <a href="/articles/${article.id}" class="btn btn-primary w-100">View</a>
        </div>
      </div>
    `;
      articleGrid.appendChild(articleCard);
    }
  };

  // Add a new article
  const addArticle = async (article) => {
    const newArticle = await fetch("/api/articles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(article),
    });
    console.log(await newArticle.json());
    loadArticles();
  };

  // Filter articles by search
  searchBar.addEventListener("input", async () => {
    // Split the input by commas or spaces, and trim each query term
    const query = searchBar.value.toLowerCase();
    if (query.trim() === "") {
      loadArticles();
      return;
    }
    const queries = query
      .split(/[\s,]+/)
      .map((q) => q.trim())
      .filter((q) => q);

    // Fetch the articles from the API
    const response = await fetch("/api/articles", {
      method: "GET",
    });
    const articles = await response.json();

    // Filter the articles based on the queries
    const filteredArticles = articles.filter((article) => {
      return queries.some(
        (query) =>
          article.title.toLowerCase().includes(query) ||
          article.source.toLowerCase().includes(query) ||
          article.tags?.some((tag) => tag.toLowerCase().includes(query)) ||
          false,
      );
    });

    // Remove duplicates and render the articles
    const setArticles = [...new Set(filteredArticles)];
    renderArticles(setArticles);
  });

  addArticleForm.addEventListener("submit", async (e) => {
    const form = e.target;
    let source = document.getElementById("articleSource").value;
    e.preventDefault();
    const formData = new FormData(e.target);
    if (articleFileType.value === "PDF" || articleFileType.value === "HTML") {
      formData.append(
        "articleSource",
        document.getElementById("articleSource").files[0],
      );
      formData.append(
        "fileType",
        document.getElementById("articleFileType").value,
      );
      formData.append("title", document.getElementById("articleTitle").value);
      const response = await fetch("/api/articles/upload", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      source = `/uploads/${result.url}`;
      if (result.type === "text/html") {
        source = result.text;
      }
    }
    const newArticle = {
      title: document.getElementById("articleTitle").value,
      source: source,
      fileType: document.getElementById("articleFileType").value,
      status: "unread",
    };
    await addArticle(newArticle);
    form.reset();
    const modal = bootstrap.Modal.getInstance(document.getElementById("modal"));
    modal.hide();
  });

  document.getElementById("articleFileType").addEventListener("change", (e) => {
    const fileType = e.target.value;
    if (fileType === "PDF" || fileType === "HTML") {
      document.getElementById("articleSource").type = "file";
    } else {
      document.getElementById("articleSource").type = "text";
    }
  });

  loadArticles();
  // populateDatalist();
});
