(function initObserverHelpers(globalScope) {
  function createPostObserver(options) {
    const { onPostsDetected } = options || {};

    if (typeof onPostsDetected !== "function") {
      throw new Error("createPostObserver requires an onPostsDetected callback");
    }

    const domHelpers = globalScope.AIFeedDetectorDOM;
    if (!domHelpers) {
      throw new Error("AIFeedDetectorDOM is not available");
    }

    const seenPosts = new WeakSet();

    function emitNewPosts(posts) {
      const unseen = posts.filter((post) => {
        if (seenPosts.has(post)) {
          return false;
        }

        seenPosts.add(post);
        return true;
      });

      if (unseen.length > 0) {
        onPostsDetected(unseen);
      }
    }

    function scanExistingPosts() {
      emitNewPosts(domHelpers.getAllPostElements());
    }

    const mutationObserver = new MutationObserver((mutations) => {
      const candidatePosts = [];

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          candidatePosts.push(...domHelpers.findPostElementsInNode(node));
        }
      }

      emitNewPosts(candidatePosts);
    });

    function start() {
      scanExistingPosts();
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    function stop() {
      mutationObserver.disconnect();
    }

    return {
      start,
      stop,
      scanExistingPosts,
    };
  }

  globalScope.AIFeedDetectorObserver = {
    createPostObserver,
  };
})(window);