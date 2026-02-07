(function initDomHelpers(globalScope) {
  const DEFAULT_POST_SELECTOR = "article";

  function getPostSelector() {
    return DEFAULT_POST_SELECTOR;
  }

  function getAllPostElements(root = document) {
    return Array.from(root.querySelectorAll(getPostSelector()));
  }

  function findPostElementsInNode(node) {
    if (!(node instanceof Element)) {
      return [];
    }

    const matches = [];

    if (node.matches(getPostSelector())) {
      matches.push(node);
    }

    matches.push(...node.querySelectorAll(getPostSelector()));

    return matches;
  }

  globalScope.AIFeedDetectorDOM = {
    getAllPostElements,
    findPostElementsInNode,
  };
})(window);
