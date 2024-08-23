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
  let isPlaintext = false;
  plaintext.style.display = "none";

  if (!articleId) {
    alert("Article ID is missing");
    return;
  }
  console.log(articleId);

  const response = await fetch(`/api/articles/${articleId}`);
  const article = await response.json();
  if (article.tags) {
    renderTags(article.tags);
    toggleRead.textContent =
      article.status === "read" ? "Mark as Unread" : "Mark as Read";
  }

  if (article.error) {
    alert(article.error);
    return;
  }

  if (article.note) document.getElementById("notes").value = article.note;
  title.textContent = article.title;
  link.href = article.source;
  link.textContent = article.source;
  readingTime.textContent = article.read ? article.read.text : "Unknown";

  status.textContent = article.status;
  if (article.archived === true) {
    status.textContent = "Archived";
    archive.textContent = "Unarchive";
  }
  embed.src = article.source;
  if (article.fileType !== "URL") {
    link.textContent = article.source.slice(29);
  }
  if (article.fileType === "URL" || article.fileType === "PDF") {
    plaintext.style.display = "inline";
  }

  embed.is = "x-frame-bypass";

  archive.addEventListener("click", async () => {
    if (article.archived) {
      article.archived = false;
      status.textContent = article.status;
      archive.textContent = "Archive";
    } else {
      article.archived = true;
      status.textContent = "Archived";
      archive.textContent = "Unarchive";
      archive.textContent = "Unarchive";
    }
    await fetch(`/api/articles/${articleId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(article),
    });
  });

  toggleRead.addEventListener("click", async () => {
    article.status = article.status === "read" ? "unread" : "read";
    await fetch(`/api/articles/${articleId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(article),
    });
    status.textContent = article.status;
    toggleRead.textContent =
      article.status === "read" ? "Mark as Unread" : "Mark as Read";
  });

  plaintext.addEventListener("click", async () => {
    if (!isPlaintext) {
      const data = await fetch(`/articles/${articleId}/markdown`);
      const html = await data.text();
      console.log(html);
      embedParent.innerHTML = html;
      isPlaintext = true;
    } else {
      embed = document.createElement("embed");
      embed.classList.add("embed-responsive-item");
      embed.id = "embed";
      embed.style.width = "100%";
      embed.style.height = "500%";
      embed.src = article.source;
      embedParent.innerHTML = "";
      embedParent.appendChild(embed);

      isPlaintext = false;
    }
  });

  const deleteArticleButton = document.getElementById("delete");
  deleteArticleButton.addEventListener("click", async () => {
    await fetch(`/api/articles/${articleId}`, {
      method: "DELETE",
    });
    window.location.href = "/";
  });

  const addNoteButton = document.getElementById("submit");
  addNoteButton.addEventListener("click", () => {
    const notes = document.getElementById("articleNotes").value;
    alert(`Notes saved: ${notes}`);
  });
  const saveTagButton = document.getElementById("saveTagButton");
  saveTagButton.addEventListener("click", async () => {
    const tagText = document.getElementById("tagInput").value;
    document.getElementById("tagInput").value = "";
    const modal = bootstrap.Modal.getInstance(
      document.getElementById("tagsmodal"),
    );
    const article = await fetch(`/api/articles/${articleId}`);
    const articleBody = await article.json();
    const newArticle = {
      id: articleBody.id,
      title: articleBody.title,
      source: articleBody.source,
      fileType: articleBody.fileType,
      status: articleBody.status,
      tags: articleBody.tags || [],
      read: articleBody.read,
    };
    const newTags = newArticle.tags;
    const splitTags = tagText.split(",");
    for (let i = 0; i < splitTags.length; i++) {
      splitTags[i] = splitTags[i].trim();
      console.log(splitTags[i]);
      newTags.push(splitTags[i]);
    }
    newArticle.tags = newTags;
    const result = await fetch(`/api/articles/${articleId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(newArticle),
    });
    const response = await result.json();
    if (response.error) {
      alert(response.error);
    } else {
      newArticle.tags = response.tags;
      if (newArticle.tags) {
        renderTags(newArticle.tags);
      }
    }
    modal.hide();
  });

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
      tagItem.textContent = `${tag}×`;
      tagItem.addEventListener("click", () => {
        removeTag(tag);
      });
      tagList.appendChild(tagItem);
    }
  }
  async function generateDatalist() {
    console.log("generating");
    const tags = await fetch("/api/articles/tags");
    const datalist = document.getElementById("options");
    const allTags = await tags.json();
    console.log({ allTags: allTags });

    // for (const tag of allTags) {
    //   const option = document.createElement("option");
    //   option.value = tag;
    //   datalist.appendChild(option);
    // }
    try {
      const tagsResponse = await fetch("/api/articles/tags");
      if (!tagsResponse.ok) {
        console.error("Failed to fetch tags:", tagsResponse.statusText);
        return;
      }
      const tags = await tagsResponse.json();
      console.log("Tags fetched:", tags);

      const datalist = document.getElementById("options");
      console.log(datalist);
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
    const article = await fetch(`/api/articles/${articleId}`);
    const articleBody = await article.json();
    let tags = articleBody.tags;
    tags = tags.filter((t) => t !== tag);
    articleBody.tags = tags;
    await fetch(`/api/articles/${articleId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(articleBody),
    });
    renderTags(articleBody.tags);
  }

  // handle notes
  async function saveNote() {
    const note = document.getElementById("notes").value;
    const article = await fetch(`/api/articles/${articleId}`);
    const articleBody = await article.json();
    articleBody.note = note;
    await fetch(`/api/articles/${articleId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(articleBody),
    });
  }
  document.getElementById("submit").addEventListener("click", saveNote);
});
