/* Levromart 2026-09-11 feature pack
 * Focus: listing billing, vendor following, smart search, order search,
 * keyboard-safe navigation, and Levi/history UX. This file is deliberately
 * additive: it wraps existing functions instead of replacing marketplace
 * renderers wholesale.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const escSafe = (v) => typeof esc === "function" ? esc(v) : String(v ?? "");
  const nairaSafe = (v) => typeof naira === "function" ? naira(v) : `₦${Number(v || 0).toLocaleString()}`;

  // -------------------------------------------------------------------------
  // 1) Listing billing / Paystack gate
  // -------------------------------------------------------------------------
  window.syncListingBillingUI = function () {
    const service = $("prodIsService")?.checked;
    const select = $("prodBillingModel");
    const hint = $("prodBillingHint");
    if (!select) return;
    if (service) {
      select.value = "monthly";
      select.disabled = true;
      if (hint) hint.textContent = "Services are monthly-only. A ₦1,000 Paystack payment is required before this service goes live.";
    } else {
      select.disabled = false;
      if (hint) {
        hint.textContent = select.value === "monthly"
          ? "This listing will stay paused until the ₦1,000 Paystack activation payment succeeds. It remains paid for one month."
          : "Commission-based listings can go live without a listing activation payment.";
      }
    }
  };

  window.syncPackageBillingUI = function () {
    const select = $("pkgBillingModel");
    const hint = $("pkgBillingHint");
    if (!select) return;
    if (hint) {
      hint.textContent = select.value === "monthly"
        ? "The package stays hidden until the ₦1,000 Paystack activation payment succeeds. It remains paid for one month."
        : "Commission-based packages can go live without a listing activation payment.";
    }
  };

  window.startListingMonthlyPayment = async function (kind, id) {
    if (!(typeof session !== "undefined" && session?.access_token)) {
      if (typeof showLogin === "function") showLogin();
      return false;
    }
    try {
      const res = await fetch("/api/listing-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        cache: "no-store",
        body: JSON.stringify({
          kind,
          id,
          accessToken: session.access_token,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authorization_url) throw new Error(data.error || "Could not start the ₦1,000 listing payment.");
      window.location.href = data.authorization_url;
      return true;
    } catch (error) {
      if (typeof showToast === "function") showToast(error.message || "Could not start the listing payment.", "error");
      return false;
    }
  };

  document.addEventListener("change", (event) => {
    if (event.target?.id === "prodIsService") window.syncListingBillingUI();
    if (event.target?.id === "prodBillingModel") window.syncListingBillingUI();
    if (event.target?.id === "pkgBillingModel") window.syncPackageBillingUI();
  }, true);

  if (typeof window.showProductModal === "function") {
    const originalShowProductModal = window.showProductModal;
    window.showProductModal = async function (...args) {
      const result = await originalShowProductModal.apply(this, args);
      window.syncListingBillingUI();
      return result;
    };
  }

  function consumeListingPaymentReturn() {
    const url = new URL(window.location.href);
    const paid = url.searchParams.get("listingPaid");
    const failed = url.searchParams.get("listingPayment");
    if (!paid && failed !== "failed") return;

    const kind = url.searchParams.get("kind");
    const id = url.searchParams.get("id");
    const reference = url.searchParams.get("reference");
    const reason = url.searchParams.get("reason");

    url.searchParams.delete("listingPaid");
    url.searchParams.delete("listingPayment");
    url.searchParams.delete("kind");
    url.searchParams.delete("id");
    url.searchParams.delete("reference");
    url.searchParams.delete("reason");

    history.replaceState(
      history.state,
      "",
      url.pathname +
      (url.searchParams.toString() ? `?${url.searchParams}` : "") +
      url.hash
    );

    if (paid === "1") {
      if (typeof showToast === "function") {
        showToast("₦1,000 received. Your listing is now live for one month.", "success");
      }

      setTimeout(() => {
        if (typeof navigate !== "function") return;
        navigate(
          kind === "package" ? "vendorPackages" : "vendorProducts",
          {},
          false
        ).catch(() => {});
      }, 80);
    } else {
      if (typeof showToast === "function") {
        showToast(
          reason === "listing"
            ? "The listing could not be activated after payment verification."
            : "The listing payment was not completed. Your listing remains paused until payment succeeds.",
          "error"
        );
      }

      setTimeout(() => {
        if (typeof navigate !== "function") return;
        navigate(
          kind === "package" ? "vendorPackages" : "vendorProducts",
          {},
          false
        ).catch(() => {});
      }, 80);
    }
  }

  setTimeout(consumeListingPaymentReturn, 450);

  // -------------------------------------------------------------------------
  // 2) Header search icon + smart global recommendations
  // -------------------------------------------------------------------------
  let globalSearchReady = false;
  let globalSearchTimer = null;
  let globalSearchRequest = 0;

  function createHeaderSearch() {
    const right = document.querySelector("header .header-right");
    if (!right) return;

    let button = $("levromartHeaderSearchButton");

    if (!button) {
      const wrap = document.createElement("div");
      wrap.className = "icon-wrap";
      wrap.id = "headerSearchWrap";

      wrap.innerHTML = `
        <button
          type="button"
          class="icon-btn header-search-btn"
          id="levromartHeaderSearchButton"
          title="Search Levromart"
          aria-label="Search Levromart"
        >
          <i class="fa-solid fa-magnifying-glass"></i>
        </button>
      `;

      const notif = $("notifWrap");

      if (notif) right.insertBefore(wrap, notif);
      else right.appendChild(wrap);

      button = $("levromartHeaderSearchButton");
    }

    let dock = $("levromartHeaderSearchDock");

    if (!dock) {
      dock = document.createElement("div");
      dock.id = "levromartHeaderSearchDock";

      dock.innerHTML = `
        <div class="header-search-shell">
          <i class="fa-solid fa-magnifying-glass header-search-leading" aria-hidden="true"></i>

          <input
            id="levromartHeaderSearchInput"
            type="search"
            autocomplete="off"
            placeholder="Search products, services, vendors…"
            aria-label="Search Levromart"
          />

          <button
            type="button"
            class="icon-btn header-search-close"
            id="levromartHeaderSearchClose"
            aria-label="Close search"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>

          <div id="levromartHeaderSearchSuggest" class="hidden"></div>
        </div>
      `;

      document.body.appendChild(dock);
    }

    const input = $("levromartHeaderSearchInput");
    const menu = $("levromartHeaderSearchSuggest");

    if (!input || !menu) return;

    const open = () => {
      dock.classList.add("open");
      document.body.classList.add("search-input-active");

      requestAnimationFrame(() => {
        input.focus({ preventScroll: true });
      });
    };

    const close = () => {
      dock.classList.remove("open");
      menu.classList.add("hidden");
      menu.innerHTML = "";
      input.blur();
      document.body.classList.remove("search-input-active");
    };

    if (button && button.dataset.headerSearchBound !== "1") {
      button.dataset.headerSearchBound = "1";

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        open();
      });
    }

    window.openLevromartHeaderSearch = open;
    window.closeLevromartHeaderSearch = close;

    if (dock.dataset.bound !== "1") {
      dock.dataset.bound = "1";

      $("levromartHeaderSearchClose")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      });

      input.addEventListener("focus", () => {
        document.body.classList.add("search-input-active");
      });

      input.addEventListener("blur", () => {
        setTimeout(() => {
          if (!dock.contains(document.activeElement)) {
            document.body.classList.remove("search-input-active");
          }
        }, 120);
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();

          const q = input.value.trim();
          if (!q) return;

          close();

          const applySearch = () => {
            const browse = $("searchInput");

            if (browse) {
              browse.value = q;
              browse.dispatchEvent(
                new Event("input", { bubbles: true })
              );
            }

            if (typeof switchHomeListingTab === "function") {
              switchHomeListingTab("products");
            }

            if (typeof filterHomeProducts === "function") {
              filterHomeProducts();
            }

            setTimeout(() => {
              $("browseSection")?.scrollIntoView({
                behavior: "smooth",
                block: "start"
              });
            }, 80);
          };

          if (
            typeof navigate === "function" &&
            (typeof currentView !== "undefined" && currentView !== "home")
          ) {
            navigate("home", {}, false)
              .then(() => setTimeout(applySearch, 80))
              .catch(() => applySearch());
          } else {
            applySearch();
          }
        }
      });

      input.addEventListener("input", () => {
        clearTimeout(globalSearchTimer);

        const q = input.value.trim();

        if (!q) {
          menu.classList.add("hidden");
          menu.innerHTML = "";
          return;
        }

        const id = ++globalSearchRequest;

        globalSearchTimer = setTimeout(async () => {
          const html = await buildSmartRecommendations(q);

          if (
            id !== globalSearchRequest ||
            input.value.trim() !== q
          ) {
            return;
          }

          menu.innerHTML = html;
          menu.classList.toggle("hidden", !html);
          attachSuggestionClicks(menu);
        }, 180);
      });
    }

    if (!document.documentElement.dataset.levroHeaderSearchDelegated) {
      document.documentElement.dataset.levroHeaderSearchDelegated = "1";

      document.addEventListener("click", (event) => {
        const target = event.target?.closest?.(
          "#levromartHeaderSearchButton"
        );

        if (!target) return;

        if (target.dataset.headerSearchBound === "1") return;

        event.preventDefault();
        event.stopPropagation();

        window.openLevromartHeaderSearch?.();
      }, true);
    }
  }

  async function buildSmartRecommendations(q) {
    q = String(q || "").trim();

    if (!q) return "";

    try {
      const terms = q
        .toLowerCase()
        .replace(/\s+/g, " ");

      const [
        idsRes,
        vendorsRes,
        packagesRes,
        catsRes,
        sectorsRes
      ] = await Promise.all([
        sb.rpc("search_product_ids", {
          p_query: terms
        }),

        sb
          .from("vendors")
          .select("id,business_name,city")
          .eq("verification_status", "verified")
          .eq("is_active", true)
          .ilike("business_name", `%${terms}%`)
          .limit(4),

        sb
          .from("vendor_packages")
          .select(
            "id,name,price,vendor:vendors!inner(id,business_name,verification_status,is_active)"
          )
          .eq("status", "active")
          .eq("vendor.verification_status", "verified")
          .eq("vendor.is_active", true)
          .or(
            `name.ilike.%${terms}%,description.ilike.%${terms}%`
          )
          .limit(4),

        sb
          .from("categories")
          .select("id,name,sector_id")
          .ilike("name", `%${terms}%`)
          .limit(5),

        sb
          .from("sectors")
          .select("id,name")
          .ilike("name", `%${terms}%`)
          .limit(4)
      ]);

      const ids = (idsRes.data || [])
        .slice(0, 6)
        .map(r => r.id)
        .filter(Boolean);

      let products = [];

      if (ids.length) {
        const { data } = await sb
          .from("products")
          .select(
            "id,name,is_service,listing_type,vendor:vendors!inner(business_name,verification_status,is_active)"
          )
          .eq("status", "active")
          .eq("vendor.verification_status", "verified")
          .eq("vendor.is_active", true)
          .in("id", ids);

        products = (data || []).sort(
          (a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)
        );
      }

      const rows = [
        ...products.map(
          p => `
            <button
              type="button"
              class="levro-smart-suggestion"
              data-action="product"
              data-id="${escSafe(p.id)}"
            >
              <i class="fa-solid ${p.is_service ? "fa-hand-holding-heart" : "fa-box"}"></i>

              <span>
                <strong>${escSafe(p.name)}</strong>
                <small>${escSafe(p.vendor?.business_name || "Product")}</small>
              </span>
            </button>
          `
        ),

        ...(packagesRes.data || []).map(
          p => `
            <button
              type="button"
              class="levro-smart-suggestion"
              data-action="package"
              data-id="${escSafe(p.id)}"
            >
              <i class="fa-solid fa-box-open"></i>

              <span>
                <strong>${escSafe(p.name)}</strong>
                <small>Package · ${nairaSafe(p.price)}</small>
              </span>
            </button>
          `
        ),

        ...(vendorsRes.data || []).map(
          v => `
            <button
              type="button"
              class="levro-smart-suggestion"
              data-action="vendor"
              data-id="${escSafe(v.id)}"
            >
              <i class="fa-solid fa-store"></i>

              <span>
                <strong>${escSafe(v.business_name)}</strong>
                <small>Vendor · ${escSafe(v.city || "")}</small>
              </span>
            </button>
          `
        ),

        ...(catsRes.data || []).map(
          c => `
            <button
              type="button"
              class="levro-smart-suggestion"
              data-action="category"
              data-id="${escSafe(c.id)}"
            >
              <i class="fa-solid fa-tags"></i>

              <span>
                <strong>${escSafe(c.name)}</strong>
                <small>Category</small>
              </span>
            </button>
          `
        ),

        ...(sectorsRes.data || []).map(
          s => `
            <button
              type="button"
              class="levro-smart-suggestion"
              data-action="sector"
              data-id="${escSafe(s.id)}"
            >
              <i class="fa-solid fa-layer-group"></i>

              <span>
                <strong>${escSafe(s.name)}</strong>
                <small>Sector</small>
              </span>
            </button>
          `
        )
      ];

      return rows.slice(0, 12).join("");
    } catch (_) {
      return "";
    }
  }

  function attachSuggestionClicks(root) {
    root
      .querySelectorAll?.(".levro-smart-suggestion")
      .forEach((btn) => {
        if (btn.dataset.bound === "1") return;

        btn.dataset.bound = "1";

        btn.addEventListener("click", () => {
          const action = btn.dataset.action;
          const id = btn.dataset.id;

          if (action === "product") {
            navigate("productDetail", {
              productId: id
            });
          } else if (action === "package") {
            navigate("packageDetail", {
              packageId: id
            });
          } else if (action === "vendor") {
            navigate("storefront", {
              vendorId: id
            });
          } else {
            const input = $("searchInput");

            if (input) {
              input.value =
                btn.querySelector("strong")?.textContent || "";
            }

            navigate("home", {}, false)
              .then(() =>
                setTimeout(() => filterHomeProducts?.(), 80)
              );
          }
        });
      });
  }

  // Browse Everything smart recommendation dropdown.
  let browseSuggestTimer = null;
  let browseSuggestRequest = 0;

  function setupBrowseSmartSearch() {
    const input = $("searchInput");

    if (!input || input.dataset.smartReady === "1") return;

    input.dataset.smartReady = "1";

    const host = input.parentElement;

    host?.classList.add("browse-smart-search-host");

    let menu = host?.querySelector(
      ".browse-smart-search-menu"
    );

    if (!menu) {
      menu = document.createElement("div");
      menu.className =
        "browse-smart-search-menu hidden";

      host?.appendChild(menu);
    }

    const show = async () => {
      const q = input.value.trim();

      if (!q) {
        menu.classList.add("hidden");
        menu.innerHTML = "";
        return;
      }

      const req = ++browseSuggestRequest;
      const html = await buildSmartRecommendations(q);

      if (
        req !== browseSuggestRequest ||
        input.value.trim() !== q
      ) {
        return;
      }

      menu.innerHTML = html;
      menu.classList.toggle("hidden", !html);
      attachSuggestionClicks(menu);
    };

    input.addEventListener("input", () => {
      clearTimeout(browseSuggestTimer);
      browseSuggestTimer = setTimeout(show, 180);
    });

    input.addEventListener("focus", () => {
      document.body.classList.add("search-input-active");

      if (input.value.trim()) {
        show();
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(() => {
        menu.classList.add("hidden");

        if (!document.querySelector("input:focus,textarea:focus")) {
          document.body.classList.remove(
            "search-input-active"
          );
        }
      }, 140);
    });
  }

  // Search inputs created by navigation are dynamic.
  const originalNavigate = window.navigate;

  if (typeof originalNavigate === "function") {
    window.navigate = async function (...args) {
      const result = await originalNavigate.apply(
        this,
        args
      );

      setTimeout(() => {
        createHeaderSearch();
        setupBrowseSmartSearch();
        setupBrowseSearchIcon();
        setupVendorSearch();

        if (
          (typeof currentView !== "undefined" &&
            currentView === "orders") ||
          /Orders/i.test(
            document.querySelector("#app h2")?.textContent || ""
          )
        ) {
          setupOrderSearch();
        }

        decorateStorefrontFollow();
        syncListingBillingUI();
        syncPackageBillingUI();
      }, 0);

      return result;
    };
  }

  // Initial pass after the app boot.
  setTimeout(() => {
    createHeaderSearch();
    setupBrowseSmartSearch();
    setupBrowseSearchIcon();
    setupVendorSearch();
    setupOrderSearch();
    decorateStorefrontFollow();
    syncListingBillingUI();
    syncPackageBillingUI();
  }, 700);

  // -------------------------------------------------------------------------
  // 3) Orders search — vendor/customer/product/amount/date/status
  // -------------------------------------------------------------------------
  window.__levroOrderSearchTerm = "";

  function orderSearchText(order, isCustomer) {
    const names = [
      isCustomer
        ? order?.vendor?.business_name
        : order?.buyer?.name,

      order?.vendor?.business_name,
      order?.buyer?.name,
      order?.status,
      order?.order_type,
      order?.total_amount,
      order?.created_at,
      orderActivityIso?.(order),

      ...(order?.items || []).map(
        i => i?.product?.name || ""
      )
    ];

    return names
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function setupOrderSearch() {
    const controls = document.querySelector(
      ".order-list-view-controls"
    );

    if (!controls) return;

    let wrap = document.querySelector(
      ".order-search-wrap"
    );

    let input = $("orderHistorySearch");

    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "order-search-wrap";

      wrap.innerHTML = `
        <button
          type="button"
          class="icon-btn order-search-toggle"
          aria-expanded="false"
          aria-label="Search order history"
          title="Search order history"
        >
          <i class="fa-solid fa-magnifying-glass"></i>
        </button>

        <i
          class="fa-solid fa-magnifying-glass order-search-leading"
          aria-hidden="true"
        ></i>

        <input
          id="orderHistorySearch"
          class="order-history-search"
          type="search"
          placeholder="Search orders by vendor, customer, product, amount or date…"
          autocomplete="off"
        />
      `;

      controls.parentElement?.insertBefore(
        wrap,
        controls
      );

      input = $("orderHistorySearch");
    } else if (
      !wrap.querySelector(".order-search-toggle")
    ) {
      const toggle =
        document.createElement("button");

      toggle.type = "button";
      toggle.className =
        "icon-btn order-search-toggle";

      toggle.setAttribute(
        "aria-label",
        "Search order history"
      );

      toggle.title = "Search order history";

      toggle.innerHTML =
        `<i class="fa-solid fa-magnifying-glass"></i>`;

      wrap.prepend(toggle);
    }

    if (!input) return;

    input.value =
      window.__levroOrderSearchTerm || "";

    const toggle =
      wrap.querySelector(".order-search-toggle");

    const setOpen = (open) => {
      wrap.classList.toggle("open", open);

      toggle?.setAttribute(
        "aria-expanded",
        String(open)
      );

      if (open) {
        document.body.classList.add(
          "search-input-active"
        );

        requestAnimationFrame(() => {
          input.focus({
            preventScroll: true
          });
        });
      } else {
        input.blur();

        if (
          !document.querySelector(
            "input:focus,textarea:focus"
          )
        ) {
          document.body.classList.remove(
            "search-input-active"
          );
        }
      }
    };

    if (
      toggle &&
      toggle.dataset.bound !== "1"
    ) {
      toggle.dataset.bound = "1";

      toggle.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          setOpen(
            !wrap.classList.contains("open")
          );
        }
      );
    }

    if (input.dataset.bound !== "1") {
      input.dataset.bound = "1";

      input.addEventListener("focus", () => {
        wrap.classList.add("open");

        toggle?.setAttribute(
          "aria-expanded",
          "true"
        );

        document.body.classList.add(
          "search-input-active"
        );
      });

      input.addEventListener("blur", () => {
        setTimeout(() => {
          if (!wrap.contains(document.activeElement)) {
            wrap.classList.remove("open");

            toggle?.setAttribute(
              "aria-expanded",
              "false"
            );

            if (
              !document.querySelector(
                "input:focus,textarea:focus"
              )
            ) {
              document.body.classList.remove(
                "search-input-active"
              );
            }
          }
        }, 120);
      });

      input.addEventListener("input", () => {
        window.__levroOrderSearchTerm =
          input.value.trim().toLowerCase();

        renderOrderListWrap();
        filterOrderHistoryDom();

        setTimeout(
          setupOrderSearch,
          0
        );
      });
    }
  }

  const originalOrderListHtml =
    window.orderListHtml;

  if (
    typeof originalOrderListHtml === "function"
  ) {
    window.orderListHtml =
      function (
        orders,
        isCustomerView,
        sourcePerspective
      ) {
        const q =
          window.__levroOrderSearchTerm || "";

        if (!q) {
          return originalOrderListHtml(
            orders,
            isCustomerView,
            sourcePerspective
          );
        }

        const filtered =
          (orders || []).filter(o =>
            orderSearchText(
              o,
              isCustomerView
            ).includes(q)
          );

        if (!filtered.length) {
          return `
            <div class="empty-state">
              <i
                class="fa-solid fa-magnifying-glass"
                style="display:block;font-size:1.35rem;margin-bottom:.4rem;"
              ></i>
              No orders match “${escSafe(q)}”.
            </div>
          `;
        }

        return originalOrderListHtml(
          filtered,
          isCustomerView,
          sourcePerspective
        );
      };
  }

  function filterOrderHistoryDom() {
    const q =
      window.__levroOrderSearchTerm || "";

    document
      .querySelectorAll(".order-history-card")
      .forEach((card) => {
        card.classList.toggle(
          "hidden",
          !!q &&
            !card.textContent
              .toLowerCase()
              .includes(q)
        );
      });

    document
      .querySelectorAll(".order-history-day")
      .forEach((day) => {
        const visible =
          [
            ...day.querySelectorAll(
              ".order-history-card"
            )
          ].some(
            c =>
              !c.classList.contains("hidden")
          );

        day.classList.toggle(
          "hidden",
          !visible
        );

        const header =
          day.previousElementSibling;

        if (
          header?.classList.contains(
            "order-history-date"
          )
        ) {
          header.classList.toggle(
            "hidden",
            !visible
          );
        }
      });
  }

  // -------------------------------------------------------------------------
  // Compact marketplace search controls
  // -------------------------------------------------------------------------
  function setupCompactSearch(
    inputId,
    wrapperSelector,
    label
  ) {
    const input = $(inputId);

    if (!input) return;

    const wrapper =
      input.closest(wrapperSelector) ||
      input.parentElement;

    if (!wrapper) return;

    wrapper.classList.add(
      "levro-compact-search-wrap"
    );

    let toggle =
      wrapper.querySelector(
        ".levro-compact-search-toggle"
      );

    if (!toggle) {
      toggle =
        document.createElement("button");

      toggle.type = "button";
      toggle.className =
        "icon-btn levro-compact-search-toggle";

      toggle.setAttribute(
        "aria-label",
        label
      );

      toggle.title = label;

      toggle.innerHTML =
        `<i class="fa-solid fa-magnifying-glass"></i>`;

      let toolbar =
        wrapper.closest(
          ".browse-filter-toolbar"
        );

      if (
        !toolbar &&
        wrapper.closest(
          ".vendors-directory-search"
        )
      ) {
        toolbar =
          wrapper.parentElement
            ?.querySelector(
              ".vendors-directory-controls"
            ) ||
          wrapper.parentElement;
      }

      toolbar =
        toolbar ||
        wrapper.parentElement;

      const filter =
        toolbar?.querySelector(
          ".browse-filter-trigger, .vendors-filters-toggle"
        );

      if (
        filter?.parentElement === toolbar
      ) {
        toolbar.insertBefore(
          toggle,
          filter.nextSibling
        );
      } else {
        toolbar?.appendChild(toggle);
      }
    }

    const open = () => {
      wrapper.classList.add("open");

      toggle.setAttribute(
        "aria-expanded",
        "true"
      );

      document.body.classList.add(
        "search-input-active"
      );

      requestAnimationFrame(() => {
        input.focus({
          preventScroll: true
        });
      });
    };

    const close = () => {
      wrapper.classList.remove("open");

      toggle.setAttribute(
        "aria-expanded",
        "false"
      );

      if (
        !document.querySelector(
          "input:focus,textarea:focus"
        )
      ) {
        document.body.classList.remove(
          "search-input-active"
        );
      }
    };

    if (
      toggle.dataset.bound !== "1"
    ) {
      toggle.dataset.bound = "1";

      toggle.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          wrapper.classList.contains("open")
            ? close()
            : open();
        }
      );

      input.addEventListener(
        "focus",
        () => {
          wrapper.classList.add("open");

          toggle.setAttribute(
            "aria-expanded",
            "true"
          );

          document.body.classList.add(
            "search-input-active"
          );
        }
      );

      input.addEventListener(
        "blur",
        () =>
          setTimeout(() => {
            if (
              !wrapper.contains(
                document.activeElement
              )
            ) {
              close();
            }
          }, 120)
      );
    }
  }

  function setupVendorSearch() {
    setupCompactSearch(
      "vendorSearchInput",
      ".vendors-directory-search",
      "Search vendors or products"
    );
  }

  function setupBrowseSearchIcon() {
    setupCompactSearch(
      "searchInput",
      ".browse-filter-toolbar",
      "Search products, packages, or services"
    );
  }

  // -------------------------------------------------------------------------
  // 4) Vendor follow/follower social layer
  // -------------------------------------------------------------------------
  async function getFollowState(vendorId) {
    if (
      !(
        typeof session !== "undefined" &&
        session?.user?.id
      ) ||
      !vendorId
    ) {
      return null;
    }

    const {
      data,
      error
    } = await sb.rpc(
      "get_vendor_follow_state",
      {
        p_vendor_id: vendorId
      }
    );

    return error
      ? null
      : data?.[0] || null;
  }

  async function refreshFollowUI(
    vendorId
  ) {
    const wrap =
      document.querySelector(
        ".storefront-follow-wrap"
      );

    if (!wrap) return;

    const state =
      await getFollowState(vendorId);

    if (!state) return;

    const btn =
      wrap.querySelector(
        ".follow-btn"
      );

    const settingsBtn =
      wrap.querySelector(
        ".follow-settings-btn"
      );

    if (btn) {
      btn.classList.toggle(
        "btn-outline",
        !state.following
      );

      btn.innerHTML =
        state.following
          ? `<i class="fa-solid fa-check"></i> Following`
          : `<i class="fa-solid fa-plus"></i> Follow`;
    }

    if (settingsBtn) {
      settingsBtn.disabled =
        !state.following;

      settingsBtn.setAttribute(
        "aria-expanded",
        wrap
          .querySelector(
            ".follow-menu"
          )
          ?.classList.contains("hidden")
          ? "false"
          : "true"
      );

      settingsBtn.title =
        state.following
          ? "Notification preferences"
          : "Follow this vendor to manage notifications";
    }

    const count =
      document.querySelector(
        "[data-follow-count]"
      );

    if (count) {
      count.textContent =
        `${Number(
          state.follower_count || 0
        ).toLocaleString()} follower${
          Number(
            state.follower_count || 0
          ) === 1
            ? ""
            : "s"
        }`;
    }

    const menu =
      wrap.querySelector(
        ".follow-menu"
      );

    if (menu) {
      menu
        .querySelectorAll(
          "input[type=checkbox]"
        )
        .forEach(cb => {
          const key =
            cb.dataset.pref;

          cb.checked =
            state[key] !== false;
        });

      menu
        .querySelectorAll(
          "[data-mute]"
        )
        .forEach(b =>
          b.classList.toggle(
            "active",
            (state.mute_mode || "none") ===
              b.dataset.mute
          )
        );
    }
  }

  async function toggleFollow(
    vendorId
  ) {
    if (
      !(
        typeof session !== "undefined" &&
        session
      )
    ) {
      showLogin();
      return;
    }

    const wrap =
      document.querySelector(
        ".storefront-follow-wrap"
      );

    const btn =
      wrap?.querySelector(
        ".follow-btn"
      );

    const state =
      await getFollowState(vendorId);

    if (!state) return;

    if (btn) {
      btn.disabled = true;
    }

    try {
      const {
        data,
        error
      } = await sb.rpc(
        "toggle_vendor_follow",
        {
          p_vendor_id: vendorId,
          p_following:
            !state.following
        }
      );

      if (error) throw error;

      if (
        typeof showToast ===
        "function"
      ) {
        showToast(
          data
            ? "You’re now following this vendor."
            : "You unfollowed this vendor.",
          "success"
        );
      }

      await refreshFollowUI(
        vendorId
      );
    } catch (e) {
      if (
        typeof showToast ===
        "function"
      ) {
        showToast(
          e.message ||
            "Could not update your following list.",
          "error"
        );
      }
    } finally {
      if (btn) {
        btn.disabled = false;
      }
    }
  }

  async function setFollowPrefs(
    vendorId,
    muteMode
  ) {
    const wrap =
      document.querySelector(
        ".storefront-follow-wrap"
      );

    if (!wrap) return;

    const checked = (key) =>
      !!wrap.querySelector(
        `[data-pref="${key}"]`
      )?.checked;

    try {
      const { error } =
        await sb.rpc(
          "set_vendor_follow_preferences",
          {
            p_vendor_id: vendorId,
            p_mute_mode: muteMode,
            p_notify_new_listing:
              checked(
                "notify_new_listing"
              ),
            p_notify_new_service:
              checked(
                "notify_new_service"
              ),
            p_notify_new_package:
              checked(
                "notify_new_package"
              ),
            p_notify_new_variety:
              checked(
                "notify_new_variety"
              ),
            p_notify_price_change:
              checked(
                "notify_price_change"
              ),
            p_notify_discount:
              checked(
                "notify_discount"
              )
          }
        );

      if (error) throw error;

      if (
        typeof showToast ===
        "function"
      ) {
        showToast(
          "Vendor notification preferences saved.",
          "success"
        );
      }

      await refreshFollowUI(
        vendorId
      );
    } catch (e) {
      if (
        typeof showToast ===
        "function"
      ) {
        showToast(
          e.message ||
            "Could not save vendor notification preferences.",
          "error"
        );
      }
    }
  }

  window.toggleLevromartVendorFollow =
    toggleFollow;

  window.setLevromartFollowPrefs =
    setFollowPrefs;

  async function decorateStorefrontFollow() {
    const vendorId =
      (
        typeof currentView !==
          "undefined" &&
        currentView ===
          "storefront"
      )
        ? (
            typeof currentViewParams !==
              "undefined"
              ? currentViewParams
                  ?.vendorId
              : null
          )
        : null;

    const title =
      document.querySelector(
        ".storefront-profile-name"
      );

    if (
      !vendorId ||
      !title ||
      document.querySelector(
        ".storefront-follow-wrap"
      )
    ) {
      return;
    }

    const stats =
      title.parentElement
        ?.querySelector(
          ".storefront-stats"
        );

    const actions =
      document.querySelector(
        ".storefront-profile-actions"
      );

    if (!actions) return;

    const state =
      await getFollowState(
        vendorId
      );

    if (
      !state ||
      (
        typeof vendor !==
          "undefined" &&
        vendor?.id === vendorId
      )
    ) {
      return;
    }

    const wrap =
      document.createElement("div");

    wrap.className =
      "storefront-follow-wrap";

    wrap.innerHTML = `
      <div class="storefront-follow-controls">
        <button
          type="button"
          class="btn btn-sm follow-btn ${
            state.following
              ? ""
              : "btn-outline"
          }"
        >
          <i class="fa-solid ${
            state.following
              ? "fa-check"
              : "fa-plus"
          }"></i>
          ${
            state.following
              ? "Following"
              : "Follow"
          }
        </button>

        <button
          type="button"
          class="btn btn-sm btn-outline follow-settings-btn"
          ${
            state.following
              ? ""
              : "disabled"
          }
          aria-expanded="false"
          aria-label="Notification preferences"
          title="${
            state.following
              ? "Notification preferences"
              : "Follow this vendor to manage notifications"
          }"
        >
          <i class="fa-solid fa-bell"></i>
          <span class="follow-settings-label">
            Alerts
          </span>
        </button>
      </div>

      <div class="follow-menu hidden">
        <strong
          style="display:block;font-size:.8rem;margin-bottom:.45rem;"
        >
          Vendor notifications
        </strong>

        <div class="follow-pref-row">
          <span>New listings</span>
          <input
            type="checkbox"
            data-pref="notify_new_listing"
          />
        </div>

        <div class="follow-pref-row">
          <span>New services</span>
          <input
            type="checkbox"
            data-pref="notify_new_service"
          />
        </div>

        <div class="follow-pref-row">
          <span>New packages</span>
          <input
            type="checkbox"
            data-pref="notify_new_package"
          />
        </div>

        <div class="follow-pref-row">
          <span>New varieties</span>
          <input
            type="checkbox"
            data-pref="notify_new_variety"
          />
        </div>

        <div class="follow-pref-row">
          <span>Price changes</span>
          <input
            type="checkbox"
            data-pref="notify_price_change"
          />
        </div>

        <div class="follow-pref-row">
          <span>Discounts</span>
          <input
            type="checkbox"
            data-pref="notify_discount"
          />
        </div>

        <small
          class="muted"
          style="display:block;margin-top:.6rem;"
        >
          Mute this vendor
        </small>

        <div class="follow-mute-grid">
          <button
            type="button"
            data-mute="none"
          >
            On
          </button>

          <button
            type="button"
            data-mute="1h"
          >
            1 hour
          </button>

          <button
            type="button"
            data-mute="8h"
          >
            8 hours
          </button>

          <button
            type="button"
            data-mute="always"
            style="grid-column:1/-1;"
          >
            Always
          </button>
        </div>
      </div>
    `;

    actions.prepend(wrap);

    const btn =
      wrap.querySelector(
        ".follow-btn"
      );

    const settingsBtn =
      wrap.querySelector(
        ".follow-settings-btn"
      );

    btn.addEventListener(
      "click",
      async (e) => {
        e.stopPropagation();

        const current =
          await getFollowState(
            vendorId
          );

        if (!current?.following) {
          await toggleFollow(
            vendorId
          );
          return;
        }

        const menu =
          wrap.querySelector(
            ".follow-menu"
          );

        menu?.classList.toggle(
          "hidden"
        );

        settingsBtn?.setAttribute(
          "aria-expanded",
          menu?.classList.contains(
            "hidden"
          )
            ? "false"
            : "true"
        );
      }
    );

    settingsBtn?.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();

        if (settingsBtn.disabled) {
          return;
        }

        const menu =
          wrap.querySelector(
            ".follow-menu"
          );

        menu?.classList.toggle(
          "hidden"
        );

        settingsBtn.setAttribute(
          "aria-expanded",
          menu?.classList.contains(
            "hidden"
          )
            ? "false"
            : "true"
        );
      }
    );

    wrap
      .querySelectorAll(
        "input[type=checkbox]"
      )
      .forEach(cb =>
        cb.addEventListener(
          "change",
          async () => {
            const current =
              await getFollowState(
                vendorId
              );

            await setFollowPrefs(
              vendorId,
              current?.mute_mode ||
                "none"
            );
          }
        )
      );

    wrap
      .querySelectorAll(
        "[data-mute]"
      )
      .forEach(b =>
        b.addEventListener(
          "click",
          () =>
            setFollowPrefs(
              vendorId,
              b.dataset.mute
            )
        )
      );

    const stat =
      document.createElement(
        "span"
      );

    stat.dataset.followCount =
      "1";

    stat.textContent =
      `${Number(
        state.follower_count || 0
      ).toLocaleString()} follower${
        Number(
          state.follower_count || 0
        ) === 1
          ? ""
          : "s"
      }`;

    stats?.appendChild(stat);

    await refreshFollowUI(
      vendorId
    );
  }

  window.decorateStorefrontFollow =
    decorateStorefrontFollow;

  // -------------------------------------------------------------------------
  // 5) Bottom nav: never jump up over a focused search field / keyboard
  // -------------------------------------------------------------------------
  const LEVRO_SEARCH_SELECTOR =
    "input[type=search], #searchInput, #heroSearch, #vendorSearchInput, #orderHistorySearch, #levromartHeaderSearchInput";

  function syncSearchKeyboardState() {
    const active =
      document.activeElement;

    document.body.classList.toggle(
      "search-input-active",
      !!active?.matches?.(
        LEVRO_SEARCH_SELECTOR
      )
    );
  }

  document.addEventListener(
    "focusin",
    (event) => {
      if (
        event.target?.matches?.(
          LEVRO_SEARCH_SELECTOR
        )
      ) {
        document.body.classList.add(
          "search-input-active"
        );
      }
    },
    true
  );

  document.addEventListener(
    "focusout",
    () => {
      setTimeout(
        syncSearchKeyboardState,
        80
      );
    },
    true
  );

  const vv =
    window.visualViewport;

  if (vv) {
    vv.addEventListener(
      "resize",
      syncSearchKeyboardState,
      { passive: true }
    );

    vv.addEventListener(
      "scroll",
      syncSearchKeyboardState,
      { passive: true }
    );
  }

  // -------------------------------------------------------------------------
  // 6) Levi history: deletion stays on history mode
  // -------------------------------------------------------------------------
  const originalDeleteAiConversation =
    window.deleteAiConversation;

  if (
    typeof originalDeleteAiConversation ===
    "function"
  ) {
    window.deleteAiConversation =
      async function (id, evt) {
        const panel =
          $("aiChatPanel");

        const wasHistory =
          !!panel?.classList.contains(
            "history-mode"
          );

        const result =
          await originalDeleteAiConversation.call(
            this,
            id,
            evt
          );

        if (wasHistory) {
          panel?.classList.add(
            "history-mode"
          );

          $("aiChatHistoryToggleBtn")
            ?.classList.add("active");

          await loadAiChatHistoryList?.();
        }

        return result;
      };
  }

  // Keep realtime grouped vendor notification updates visible immediately.
  let followNotificationChannel;

  function attachFollowNotificationUpdates() {
    if (
      !session?.user?.id ||
      typeof sb?.channel !== "function"
    ) {
      return;
    }

    try {
      followNotificationChannel
        ?.unsubscribe?.();
    } catch (_) {}

    followNotificationChannel =
      sb.channel(
        `vendor-follow-updates-${session.user.id}`
      )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter:
              `user_id=eq.${session.user.id}`
          },
          () => {
            try {
              refreshNotifications?.(
                false
              );
            } catch (_) {}
          }
        )
        .subscribe();
  }

  setTimeout(
    attachFollowNotificationUpdates,
    1800
  );

})();
