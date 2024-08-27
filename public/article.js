document.addEventListener("DOMContentLoaded", async () => {
  const title = document.getElementById("title");
  const link = document.getElementById("link");
  const toggleRead = document.getElementById("mark");
  const plaintext = document.getElementById("plaintext");
  const status = document.getElementById("badge");
  const archive = document.getElementById("archive");
  const readingTime = document.getElementById("reading");
  const url = window.location.href.split("/");
  const articleId = url[url.length - 1];
  let embed = document.getElementById("embed");
  const embedParent = embed.parentElement;
  const hoverPreview = document.getElementById("hover-preview");
  const previewContent = document.getElementById("preview-content");
  const previewNotes = document.getElementById("preview-notes");
  const summary = document.getElementById("summaryText");
  let isPlaintext = false;
  plaintext.style.display = "none";

  function showPreview(event) {
    const card = event.currentTarget;

    console.log("Hovering");
    const source = card.getAttribute("data-source");
    previewContent.innerHTML = `<embed src="${source}" width="100%" height="100%"/>`;
    previewNotes.innerHTML = card.getAttribute("data-description");
    hoverPreview.style.display = "block";
  }
  function hidePreview() {
    hoverPreview.style.display = "none";
  }
  function movePreview(event) {
    const offsetX = 0;
    const previewWidth = hoverPreview.offsetWidth;
    const previewHeight = hoverPreview.offsetHeight;

    const left = event.pageX + offsetX - previewWidth / 2;
    const top = event.pageY - 30;

    const windowWidth = window.innerWidth;

    const finalLeft = Math.min(Math.max(0, left), windowWidth - previewWidth);
    const finalTop = top - previewHeight - 3;

    hoverPreview.style.left = `${finalLeft}px`;
    hoverPreview.style.top = `${finalTop}px`;
  }

  if (!articleId) {
    alert("Article ID is missing");
    return;
  }

  const response = await fetch(`/api/articles/${articleId}`);
  const article = await response.json();

  if (article.error) {
    alert(article.error);
    return;
  }

  if (article.note) document.getElementById("notes").value = article.note;
  title.textContent = article.title;
  link.href = article.source;
  link.textContent = article.source;
  readingTime.textContent = article.read ? article.read.text : "Unknown";
  status.textContent = article.archived ? "Archived" : article.status;
  archive.textContent = article.archived ? "Unarchive" : "Archive";
  toggleRead.textContent =
    article.status === "read" ? "Mark as Unread" : "Mark as Read";

  if (article.tags) renderTags(article.tags);
  const tagsAll = article.tags;

  embed.src = article.source;
  if (article.fileType !== "URL") link.textContent = article.source.slice(29);
  if (article.fileType === "URL" || article.fileType === "PDF") {
    plaintext.style.display = "inline";
  }
  embed.is = "x-frame-bypass";

  const summaryText = await fetch(`/articles/${articleId}/summary`);
  const summaryTexts = await summaryText.json();

  if (summaryTexts.length > 0) {
    summary.innerHTML = summaryTexts.slice(0, 3).join(". ");
  }
  archive.addEventListener("click", async () => {
    article.archived = !article.archived;
    status.textContent = article.archived ? "Archived" : article.status;
    archive.textContent = article.archived ? "Unarchive" : "Archive";
    await updateArticle(article);
  });

  toggleRead.addEventListener("click", async () => {
    article.status = article.status === "read" ? "unread" : "read";
    status.textContent = article.status;
    toggleRead.textContent =
      article.status === "read" ? "Mark as Unread" : "Mark as Read";
    await updateArticle(article);
  });

  plaintext.addEventListener("click", async () => {
    isPlaintext = !isPlaintext;
    if (isPlaintext) {
      await displayPlaintext(articleId, embedParent);
    } else {
      resetEmbed(embedParent, article.source);
    }
  });

  document.getElementById("delete").addEventListener("click", async () => {
    await fetch(`/api/articles/${articleId}`, { method: "DELETE" });
    window.location.href = "/";
  });

  document.getElementById("submit").addEventListener("click", saveNote);

  document
    .getElementById("saveTagButton")
    .addEventListener("click", async () => {
      await saveTags(articleId);
    });

  generateDatalist();

  async function updateArticle(updatedArticle) {
    await fetch(`/api/articles/${articleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedArticle),
    });
  }

  function renderTags(tags) {
    const tagList = document.getElementById("tags");
    tagList.innerHTML = "";
    for (const tag of tags) {
      const tagItem = document.createElement("span");
      tagItem.classList.add(
        "badge",
        "rounded-pill",
        "bg-primary",
        "text-white",
        "mx-1",
        "px-3",
        "py-1",
        "shadow-sm",
      );
      tagItem.textContent = `${tag} ×`;
      tagItem.addEventListener("click", () => removeTag(tag));
      tagList.appendChild(tagItem);
    }
  }

  async function saveTags(articleId) {
    const tagText = document.getElementById("tagInput").value;
    document.getElementById("tagInput").value = "";
    const modal = bootstrap.Modal.getInstance(
      document.getElementById("tagsmodal"),
    );

    const response = await fetch(`/api/articles/${articleId}`);
    const article = await response.json();
    const newTags = (article.tags || []).concat(
      tagText.split(",").map((tag) => tag.trim()),
    );
    article.tags = [...new Set(newTags)];

    const updateResponse = await fetch(`/api/articles/${articleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(article),
    });
    const updatedArticle = await updateResponse.json();

    if (!updatedArticle.error) {
      renderTags(updatedArticle.tags);
    } else {
      alert(updatedArticle.error);
    }
    modal.hide();
  }

  async function generateDatalist() {
    try {
      const tagsResponse = await fetch("/api/articles/tags");
      const tags = await tagsResponse.json();
      const datalist = document.getElementById("options");
      for (const tag of tags) {
        const option = document.createElement("option");
        option.value = tag;
        datalist.appendChild(option);
      }
    } catch (error) {
      console.error("Error fetching tags:", error);
    }
  }

  async function removeTag(tag) {
    const response = await fetch(`/api/articles/${articleId}`);
    const article = await response.json();
    article.tags = article.tags.filter((t) => t !== tag);
    await updateArticle(article);
    renderTags(article.tags);
  }

  async function saveNote() {
    const note = document.getElementById("notes").value;
    const response = await fetch(`/api/articles/${articleId}`);
    const article = await response.json();
    article.note = note;
    await updateArticle(article);
  }

  async function displayPlaintext(articleId, embedParent) {
    const currentPage = 1;
    const pageSize = 10000;

    const fetchPage = async (page) => {
      const response = await fetch(
        `/articles/${articleId}/markdown?page=${page}&pageSize=${pageSize}`,
      );
      return await response.json();
    };

    const displayContent = (htmlContent, page, totalPages) => {
      embedParent.innerHTML = `<div class="page">${htmlContent}`;
      if (totalPages > 1) {
        const paginationControls = createPaginationControls(
          page,
          totalPages,
          fetchPage,
          displayContent,
        );
        embedParent.appendChild(paginationControls);
      }
    };

    const data = await fetchPage(currentPage);
    displayContent(data.content, data.page, data.totalPages);
  }

  function resetEmbed(embedParent, source) {
    embed = document.createElement("embed");
    embed.classList.add("embed-responsive-item");
    embed.id = "embed";
    embed.style.width = "100%";
    embed.style.height = "500px";
    embed.src = source;
    embedParent.innerHTML = "";
    embedParent.appendChild(embed);
  }

  function createPaginationControls(
    page,
    totalPages,
    fetchPage,
    displayContent,
  ) {
    const paginationControls = document.createElement("ul");
    paginationControls.classList.add("pagination");

    // Previous Button
    const prevButtonList = document.createElement("li");
    prevButtonList.classList.add("page-item");
    const prevButton = document.createElement("a");
    prevButton.classList.add("page-link");
    prevButton.innerText = "Previous";
    prevButton.disabled = page <= 1;
    prevButton.onclick = async () => {
      const data = await fetchPage(page - 1);
      displayContent(data.content, data.page, data.totalPages);
    };
    prevButtonList.appendChild(prevButton);
    paginationControls.appendChild(prevButtonList);

    // Page Numbers
    for (let i = 1; i <= totalPages; i++) {
      const pageItemList = document.createElement("li");
      pageItemList.classList.add("page-item");
      const pageLink = document.createElement("a");
      pageLink.classList.add("page-link");
      pageLink.innerText = i;
      pageLink.onclick = async () => {
        const data = await fetchPage(i);
        displayContent(data.content, data.page, data.totalPages);
      };
      if (i === page) {
        pageItemList.classList.add("active");
      }
      pageItemList.appendChild(pageLink);
      paginationControls.appendChild(pageItemList);
    }

    // Next Button
    const nextButtonList = document.createElement("li");
    nextButtonList.classList.add("page-item");
    const nextButton = document.createElement("a");
    nextButton.classList.add("page-link");
    nextButton.innerText = "Next";
    nextButton.disabled = page >= totalPages;
    nextButton.onclick = async () => {
      const data = await fetchPage(page + 1);
      displayContent(data.content, data.page, data.totalPages);
    };
    nextButtonList.appendChild(nextButton);
    paginationControls.appendChild(nextButtonList);

    return paginationControls;
  }

  async function relatedArticles() {
    const currentArticleId = articleId;
    fetch("/api/articles/tags")
      .then((response) => response.json())
      .then(async (_) => {
        const response = await fetch("/api/articles/");
        const articles = await response.json();
        const currentArticleTags = tagsAll;
        if (!Array.isArray(currentArticleTags)) {
          console.error("Current article tags are not valid");
          return;
        }
        const relatedArticles = articles.filter((article) => {
          if (!article.tags || !Array.isArray(article.tags)) {
            return false;
          }

          return (
            article.tags.some((tag) => currentArticleTags.includes(tag)) &&
            article.id !== currentArticleId
          );
        });
        // Display related articles
        const relatedArticlesList = document.getElementById(
          "related-articles-list",
        );
        if (relatedArticlesList) {
          // Display related articles
          const relatedArticlesList_1 = document.getElementById(
            "related-articles-list",
          );
          relatedArticlesList_1.innerHTML = relatedArticles
            .map(
              (article_1) => `
            <div class="col-md-4">
              <div class="card related-article-card" data-title="${article_1.title}" data-description="${article_1.note || ""}" data-link="/articles/${article_1.id}" data-source="${article_1.source}">
                <div class="card-body">
                  <h5 class="card-title related-article-title">${article_1.title}</h5>
                  <p class="card-text related-article-description" id="article-source">${article_1.tags}</p>
                  <a href="/articles/${article_1.id}" class="btn btn-primary" id="card-id">Read More</a>
                </div>
              </div>
            </div>
          `,
            )
            .join("");

          for (const card of document.querySelectorAll(
            ".related-article-card",
          )) {
            // Handle hover preview
            card.addEventListener("mouseenter", showPreview);
            card.addEventListener("mouseleave", hidePreview);
            card.addEventListener("mousemove", movePreview);
          }
        }
      });
  }
  relatedArticles();
});
