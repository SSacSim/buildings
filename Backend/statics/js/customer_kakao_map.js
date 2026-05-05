(function () {
    const modalEl = document.getElementById("customerKakaoMapModal");
    const introOpenBtn = document.getElementById("openCustomerKakaoMapBtn");
    const matchOpenBtn = document.getElementById("openCustomerMatchKakaoMapBtn");
    const closeBtn = document.getElementById("closeCustomerKakaoMapBtn");
    const titleEl = document.getElementById("customerKakaoMapTitle");
    const resultEl = document.getElementById("customerKakaoMapResult");
    const mapContainer = document.getElementById("customerKakaoMap");

    if (!modalEl || (!introOpenBtn && !matchOpenBtn) || !closeBtn || !resultEl || !mapContainer) {
        return;
    }

    const KAKAO_APP_KEY = (modalEl.dataset.kakaoAppKey || "").trim();
    const DEFAULT_CENTER = { lat: 37.5662952, lng: 126.9779451 };
    const LARGE_MAP_CONFIRM_THRESHOLD = 500;
    const GEOCODE_CACHE_SAVE_BATCH_SIZE = 50;

    let sdkPromise = null;
    let map = null;
    let geocoder = null;
    let openHoverPopup = null;
    let hoverCloseTimer = null;
    let allBounds = null;
    let hasBoundsPoint = false;
    let mapInitialized = false;
    let refreshSequence = 0;
    let activeOpenToken = 0;
    let mapRequestController = null;
    let latestIntroItems = [];
    let latestMatchItems = [];
    let currentMapMode = "intro";

    const geocodeCache = new Map();
    const pendingGeocodeCacheItems = [];
    const pendingGeocodeCacheKeys = new Set();
    const introMarkers = [];
    const HOVER_CLOSE_DELAY_MS = 180;
    let geocodeCacheFlushTimer = null;

    function escapeHtml(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function setResult(text) {
        resultEl.textContent = text;
    }

    function getMapModeTitle(mode) {
        return mode === "match" ? "매칭 결과 지도" : "소개매물 지도";
    }

    function getMapModeDescription(mode) {
        return mode === "match"
            ? "매칭 결과에 포함된 주소를 지도에 표시합니다."
            : "소개매물에 등록된 주소를 지도에 표시합니다.";
    }

    function setMapMode(mode) {
        currentMapMode = mode === "match" ? "match" : "intro";
        if (titleEl) {
            titleEl.textContent = getMapModeTitle(currentMapMode);
        }
    }

    function confirmLargeMapRequest(itemCount) {
        const count = Number(itemCount);
        if (!Number.isFinite(count)) return true;
        if (count < LARGE_MAP_CONFIRM_THRESHOLD) return true;
        return window.confirm(
            `지도에 표시할 주소가 ${count.toLocaleString()}건입니다.\n카카오 API 호출량이 많아질 수 있습니다.\n계속 진행하시겠습니까?`
        );
    }

    function getKnownMapItemCount(mode, explicitItems) {
        if (Array.isArray(explicitItems)) {
            return normalizeIntroItems(explicitItems).length;
        }
        const getterName = mode === "match"
            ? "getCustomerMatchMapItemCount"
            : "getCustomerIntroMapItemCount";
        const getter = window[getterName];
        if (typeof getter === "function") {
            try {
                const count = Number(getter());
                if (Number.isFinite(count)) return Math.max(0, count);
            } catch (error) {
                console.error("failed to read customer map item count", error);
            }
        }
        const items = mode === "match" ? latestMatchItems : latestIntroItems;
        return items.length;
    }

    function setDataLoadingProgress(progress = {}) {
        const loaded = Math.max(0, Number(progress.loaded) || 0);
        const total = Math.max(0, Number(progress.total) || 0);
        if (total > 0) {
            setResult(`지도 데이터 가져오는 중... ${Math.min(loaded, total).toLocaleString()} / ${total.toLocaleString()}건`);
            return;
        }
        setResult(`지도 데이터 가져오는 중... ${loaded.toLocaleString()}건`);
    }

    function isAbortError(error) {
        return error && error.name === "AbortError";
    }

    function abortActiveMapRequest() {
        if (!mapRequestController) return;
        mapRequestController.abort();
        mapRequestController = null;
    }

    function clearMapState({ clearItems = false, recenter = false } = {}) {
        refreshSequence += 1;
        closeOpenedInfoWindow();
        clearMarkerGroup(introMarkers);
        resetBounds();
        if (clearItems) {
            latestIntroItems = [];
            latestMatchItems = [];
        }
        if (recenter) {
            fitBoundsOrCenter();
        }
    }

    function beginMapRequest({ clearItems = false, recenter = false } = {}) {
        activeOpenToken += 1;
        abortActiveMapRequest();
        clearMapState({ clearItems, recenter });

        const controller = typeof AbortController === "function"
            ? new AbortController()
            : null;
        mapRequestController = controller;
        return {
            token: activeOpenToken,
            controller,
            signal: controller ? controller.signal : undefined,
        };
    }

    function isCurrentMapRequest(request) {
        if (!request || request.token !== activeOpenToken) return false;
        return !(request.signal && request.signal.aborted);
    }

    function finishMapRequest(request) {
        if (request && mapRequestController === request.controller) {
            mapRequestController = null;
        }
    }

    function cancelMapWork({ clearItems = false, recenter = false } = {}) {
        activeOpenToken += 1;
        abortActiveMapRequest();
        clearMapState({ clearItems, recenter });
    }

    function setMapLinkInteractionActive(active) {
        if (!map) return;
        map.setCursor(active ? "pointer" : "");
        map.setDraggable(!active);
    }

    function closeOpenedInfoWindow() {
        if (hoverCloseTimer) {
            window.clearTimeout(hoverCloseTimer);
            hoverCloseTimer = null;
        }
        if (!openHoverPopup) return;
        openHoverPopup.close();
        if (openHoverPopup.linkable) {
            setMapLinkInteractionActive(false);
        }
        openHoverPopup = null;
    }

    function openDetailLink(url) {
        const safeUrl = String(url || "").trim();
        if (!safeUrl) {
            console.warn("detail url is empty for this marker");
            return;
        }
        const opened = window.open(safeUrl, "_blank", "noopener,noreferrer");
        if (opened) {
            try {
                opened.opener = null;
            } catch (e) {
                // ignore cross-browser opener assignment failures
            }
            return;
        }
        console.warn("popup blocked while opening detail link", safeUrl);
        // alert("브라우저 팝업이 차단되어 새 창을 열지 못했습니다. 이 사이트의 팝업 허용 후 다시 시도해 주세요.");
    }

    function clearHoverCloseTimer() {
        if (!hoverCloseTimer) return;
        window.clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
    }

    function scheduleHoverClose(hoverPopup) {
        clearHoverCloseTimer();
        hoverCloseTimer = window.setTimeout(() => {
            if (openHoverPopup !== hoverPopup) return;
            hoverPopup.close();
            if (hoverPopup.linkable) {
                setMapLinkInteractionActive(false);
            }
            openHoverPopup = null;
            hoverCloseTimer = null;
        }, HOVER_CLOSE_DELAY_MS);
    }

    function clearMarkerGroup(markerGroup) {
        while (markerGroup.length) {
            const marker = markerGroup.pop();
            if (marker && typeof marker.setMap === "function") {
                marker.setMap(null);
            }
        }
    }

    function resetBounds() {
        if (!window.kakao || !window.kakao.maps) return;
        allBounds = new kakao.maps.LatLngBounds();
        hasBoundsPoint = false;
    }

    function extendBounds(position) {
        if (!allBounds || !position) return;
        allBounds.extend(position);
        hasBoundsPoint = true;
    }

    function fitBoundsOrCenter() {
        if (!map || !window.kakao || !window.kakao.maps) return;
        if (hasBoundsPoint && allBounds) {
            map.setBounds(allBounds);
            return;
        }
        map.setCenter(new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng));
        map.setLevel(6);
    }

    function relayoutMap() {
        if (!map) return;
        window.setTimeout(() => {
            map.relayout();
            fitBoundsOrCenter();
        }, 0);
    }

    function createHoverPopup(position, content, detailUrl = "") {
        const root = document.createElement("div");
        root.style.pointerEvents = "auto";
        root.style.position = "relative";
        root.style.transform = "translateY(-52px)";
        root.style.willChange = "transform";
        root.innerHTML = `
            <div style="position: relative; display: inline-block;">
                ${content}
                <div style="
                    position: absolute;
                    left: 50%;
                    bottom: -8px;
                    transform: translateX(-50%);
                    width: 0;
                    height: 0;
                    border-left: 8px solid transparent;
                    border-right: 8px solid transparent;
                    border-top: 8px solid #eef2ff;
                    filter: drop-shadow(0 2px 1px rgba(15, 23, 42, 0.12));
                    pointer-events: none;
                "></div>
            </div>
        `;

        const overlay = new kakao.maps.CustomOverlay({
            position,
            content: root,
            xAnchor: 0.5,
            yAnchor: 1,
            zIndex: 5
        });
        overlay.setMap(null);
        const popup = {
            open: () => overlay.setMap(map),
            close: () => overlay.setMap(null),
            linkable: Boolean(detailUrl),
        };

        root.addEventListener("mouseenter", () => {
            clearHoverCloseTimer();
            if (popup.linkable) {
                setMapLinkInteractionActive(true);
            }
        });
        root.addEventListener("mouseleave", () => {
            scheduleHoverClose(popup);
        });
        root.addEventListener("mousedown", () => {
            if (window.kakao && kakao.maps && kakao.maps.event && typeof kakao.maps.event.preventMap === "function") {
                kakao.maps.event.preventMap();
            }
        });
        if (detailUrl) {
            root.style.cursor = "pointer";
            root.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (window.kakao && kakao.maps && kakao.maps.event && typeof kakao.maps.event.preventMap === "function") {
                    kakao.maps.event.preventMap();
                }
                openDetailLink(detailUrl);
            });
        }

        return popup;
    }

    function bindMarkerHover(marker, hoverPopup) {
        kakao.maps.event.addListener(marker, "mouseover", () => {
            clearHoverCloseTimer();
            if (openHoverPopup && openHoverPopup !== hoverPopup) {
                openHoverPopup.close();
            }
            if (openHoverPopup === hoverPopup) {
                return;
            }
            closeOpenedInfoWindow();
            hoverPopup.open();
            openHoverPopup = hoverPopup;
            if (hoverPopup.linkable) {
                setMapLinkInteractionActive(true);
            }
        });

        kakao.maps.event.addListener(marker, "mouseout", () => {
            scheduleHoverClose(hoverPopup);
        });
    }

    function ensureKakaoSdk() {
        if (!KAKAO_APP_KEY) {
            return Promise.reject(new Error("kakao app key missing"));
        }
        if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
            return Promise.resolve();
        }
        if (sdkPromise) return sdkPromise;

        sdkPromise = new Promise((resolve, reject) => {
            const existingScript = document.getElementById("customerKakaoMapSdk");
            if (existingScript) {
                existingScript.addEventListener("load", resolve, { once: true });
                existingScript.addEventListener("error", reject, { once: true });
                return;
            }

            const script = document.createElement("script");
            script.id = "customerKakaoMapSdk";
            script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_APP_KEY)}&autoload=false&libraries=services`;
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error("kakao sdk load failed"));
            document.head.appendChild(script);
        });

        return sdkPromise;
    }

    async function initializeMap() {
        if (mapInitialized) {
            relayoutMap();
            return;
        }

        await ensureKakaoSdk();
        await new Promise((resolve, reject) => {
            if (!window.kakao || !window.kakao.maps) {
                reject(new Error("kakao maps unavailable"));
                return;
            }

            kakao.maps.load(() => {
                if (!kakao.maps.services) {
                    reject(new Error("kakao maps services unavailable"));
                    return;
                }

                map = new kakao.maps.Map(mapContainer, {
                    center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
                    level: 6
                });

                geocoder = new kakao.maps.services.Geocoder();
                resetBounds();
                kakao.maps.event.addListener(map, "click", () => {
                    closeOpenedInfoWindow();
                });
                kakao.maps.event.addListener(map, "dragstart", () => {
                    closeOpenedInfoWindow();
                });
                mapInitialized = true;
                resolve();
            });
        });
    }

    function normalizeIntroItems(items) {
        if (!Array.isArray(items)) return [];

        const seen = new Set();
        return items
            .map((item) => {
                const address = String(item?.address || "").trim();
                if (!address) return null;

                const bdNumber = String(item?.bd_number || "").trim();
                const bdName = String(item?.bd_name || "").trim();
                const salePrice = String(item?.sale_price || "").trim();
                const detailUrl = String(item?.detail_url || "").trim() || (bdNumber ? `/detail/${encodeURIComponent(bdNumber)}` : "");
                const lat = Number(item?.lat ?? item?.kakao_lat);
                const lng = Number(item?.lng ?? item?.kakao_lng);
                const key = `${bdNumber}|${address}`;
                if (seen.has(key)) return null;
                seen.add(key);

                const normalized = {
                    bd_number: bdNumber || null,
                    bd_name: bdName,
                    address: address,
                    sale_price: salePrice,
                    detail_url: detailUrl
                };
                if (Number.isFinite(lat) && Number.isFinite(lng)) {
                    normalized.lat = lat;
                    normalized.lng = lng;
                }
                return normalized;
            })
            .filter(Boolean);
    }

    function getIntroItemsFromSource() {
        if (typeof window.getCustomerIntroMapItems === "function") {
            try {
                return normalizeIntroItems(window.getCustomerIntroMapItems());
            } catch (error) {
                console.error("failed to read intro map items", error);
            }
        }
        return normalizeIntroItems(latestIntroItems);
    }

    async function getMatchItemsFromSource(options = {}) {
        if (typeof window.getCustomerMatchMapItems === "function") {
            try {
                const items = await Promise.resolve(window.getCustomerMatchMapItems(options));
                return normalizeIntroItems(items);
            } catch (error) {
                if (isAbortError(error)) throw error;
                console.error("failed to read match map items", error);
            }
        }
        return normalizeIntroItems(latestMatchItems);
    }

    async function getMapItemsFromSource(mode, explicitItems, options = {}) {
        if (Array.isArray(explicitItems)) {
            return normalizeIntroItems(explicitItems);
        }
        if (mode === "match") {
            return getMatchItemsFromSource(options);
        }
        return getIntroItemsFromSource();
    }

    function geocodeAddress(address) {
        const key = String(address || "").trim();
        if (!key) return Promise.resolve(null);
        if (geocodeCache.has(key)) return Promise.resolve(geocodeCache.get(key));

        return new Promise((resolve) => {
            geocoder.addressSearch(key, (result, status) => {
                if (status !== kakao.maps.services.Status.OK || !Array.isArray(result) || !result.length) {
                    geocodeCache.set(key, null);
                    resolve(null);
                    return;
                }

                const first = result[0];
                const lat = Number(first.y);
                const lng = Number(first.x);
                if (Number.isNaN(lat) || Number.isNaN(lng)) {
                    geocodeCache.set(key, null);
                    resolve(null);
                    return;
                }

                const payload = {
                    lat: lat,
                    lng: lng,
                    address_name: first.address_name || key
                };
                geocodeCache.set(key, payload);
                resolve(payload);
            });
        });
    }

    function getCachedGeoFromItem(item) {
        const lat = Number(item?.lat ?? item?.kakao_lat);
        const lng = Number(item?.lng ?? item?.kakao_lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        const payload = {
            lat: lat,
            lng: lng,
            address_name: item.address
        };
        geocodeCache.set(item.address, payload);
        return payload;
    }

    function scheduleGeocodeCacheFlush() {
        if (geocodeCacheFlushTimer) return;
        geocodeCacheFlushTimer = window.setTimeout(() => {
            geocodeCacheFlushTimer = null;
            void flushGeocodeCacheSaves();
        }, 500);
    }

    async function flushGeocodeCacheSaves() {
        if (!pendingGeocodeCacheItems.length) return;
        if (geocodeCacheFlushTimer) {
            window.clearTimeout(geocodeCacheFlushTimer);
            geocodeCacheFlushTimer = null;
        }

        const items = pendingGeocodeCacheItems.splice(0, pendingGeocodeCacheItems.length);
        pendingGeocodeCacheKeys.clear();
        try {
            await fetch("/api/building/geocode-cache", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items })
            });
        } catch (error) {
            console.error("failed to save geocode cache", error);
        }
    }

    function queueGeocodeCacheSave(item, geo) {
        const bdNumber = String(item?.bd_number || "").trim();
        const address = String(item?.address || "").trim();
        const lat = Number(geo?.lat);
        const lng = Number(geo?.lng);
        if (!bdNumber || !address || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const key = `${bdNumber}|${address}`;
        if (pendingGeocodeCacheKeys.has(key)) return;
        pendingGeocodeCacheKeys.add(key);
        pendingGeocodeCacheItems.push({
            bd_number: bdNumber,
            address: address,
            lat: lat,
            lng: lng,
            status: "ok"
        });
        if (pendingGeocodeCacheItems.length >= GEOCODE_CACHE_SAVE_BATCH_SIZE) {
            void flushGeocodeCacheSaves();
            return;
        }
        scheduleGeocodeCacheFlush();
    }

    async function resolveItemGeo(item) {
        const cachedGeo = getCachedGeoFromItem(item);
        if (cachedGeo) return cachedGeo;

        const geo = await geocodeAddress(item.address);
        if (geo) queueGeocodeCacheSave(item, geo);
        return geo;
    }

    function buildIntroInfoContent(item) {
        const safeAddress = escapeHtml(item?.address || "-");
        const safeSalePrice = escapeHtml(item?.sale_price || "-");
        const safeBuildingName = escapeHtml(item?.bd_name || "");
        const hasBuildingName = safeBuildingName && safeBuildingName !== "-";
        const salePriceLabel = safeSalePrice && safeSalePrice !== "-" ? safeSalePrice : "정보 없음";

        return `
            <div style="
                min-width: 260px;
                max-width: 320px;
                border-radius: 14px;
                overflow: hidden;
                background: linear-gradient(145deg, #ffffff 0%, #f8fafc 65%, #eef2ff 100%);
                color: #0f172a;
                box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);
                font-family: Pretendard, 'Malgun Gothic', sans-serif;
            ">
                <div style="padding: 11px 12px 12px;">
                    ${hasBuildingName ? `
                        <div style="
                            margin-bottom: 6px;
                            font-size: 11px;
                            font-weight: 700;
                            color: #475569;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        ">${safeBuildingName}</div>
                    ` : ""}
                    <div style="
                        font-size: 12px;
                        line-height: 1.45;
                        font-weight: 800;
                        color: #1e293b;
                        word-break: break-all;
                    ">${safeAddress}</div>
                    <div style="
                        margin-top: 11px;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 10px;
                    ">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="
                                display: inline-flex;
                                align-items: center;
                                border-radius: 999px;
                                padding: 2px 8px;
                                font-size: 10px;
                                font-weight: 800;
                                color: #1d4ed8;
                                background: #dbeafe;
                            ">매매가</span>
                            <span style="
                                font-size: 15px;
                                line-height: 1;
                                font-weight: 900;
                                color: #1e40af;
                                letter-spacing: 0.02em;
                            ">${salePriceLabel}</span>
                        </div>
                        <span style="font-size:10px; font-weight:700; color:#64748b;">상세보기 ↗</span>
                    </div>
                </div>
            </div>
        `;
    }

    async function renderIntroMarkers(items) {
        if (!map || !geocoder || !window.kakao || !window.kakao.maps) return;

        closeOpenedInfoWindow();
        clearMarkerGroup(introMarkers);
        resetBounds();

        const normalized = normalizeIntroItems(items);
        if (!normalized.length) {
            fitBoundsOrCenter();
            setResult("소개 매물에 등록된 주소가 없습니다.");
            return;
        }

        const sequence = ++refreshSequence;
        let processedCount = 0;
        let renderedCount = 0;
        let linkableCount = 0;

        for (const item of normalized) {
            const geo = await resolveItemGeo(item);
            if (sequence !== refreshSequence) return;
            processedCount += 1;
            if (processedCount % 20 === 0 || processedCount === normalized.length) {
                setResult(`주소를 좌표로 변환하는 중입니다... ${processedCount.toLocaleString()} / ${normalized.length.toLocaleString()}건`);
            }
            if (!geo) continue;

            const position = new kakao.maps.LatLng(geo.lat, geo.lng);
            const marker = new kakao.maps.Marker({
                map: map,
                position: position,
                title: item.address,
                clickable: true
            });
            introMarkers.push(marker);
            extendBounds(position);

            const hoverPopup = createHoverPopup(position, buildIntroInfoContent(item), item.detail_url);
            bindMarkerHover(marker, hoverPopup);

            if (item.detail_url) {
                linkableCount += 1;
                kakao.maps.event.addListener(marker, "click", () => {
                    openDetailLink(item.detail_url);
                });
            }

            renderedCount += 1;
        }
        void flushGeocodeCacheSaves();

        fitBoundsOrCenter();
        if (renderedCount > 0) {
            setResult(`소개매물 ${renderedCount}건 표시 (상세연결 ${linkableCount}건).`);
            return;
        }
        setResult("소개 매물 주소를 좌표로 변환하지 못했습니다.");
    }

    async function refreshIntroMarkers(mode = currentMapMode, explicitItems, options = {}) {
        const sourceItems = await getMapItemsFromSource(mode, explicitItems, options);
        if (mode === "match") {
            latestMatchItems = normalizeIntroItems(sourceItems);
        } else {
            latestIntroItems = normalizeIntroItems(sourceItems);
        }
        const itemsToRender = mode === "match" ? latestMatchItems : latestIntroItems;
        if (!mapInitialized || options.skipRender) return true;
        await renderIntroMarkers(itemsToRender);
        return true;
    }

    async function openMapModal(mode = "intro") {
        setMapMode(mode);
        const knownItemCount = getKnownMapItemCount(currentMapMode);
        if (!confirmLargeMapRequest(knownItemCount)) return;
        const request = beginMapRequest({ clearItems: true, recenter: true });

        try {
            modalEl.classList.remove("hidden");
            modalEl.classList.add("flex");
            setDataLoadingProgress({ loaded: 0, total: knownItemCount });

            await refreshIntroMarkers(currentMapMode, undefined, {
                skipRender: true,
                onProgress: setDataLoadingProgress,
                signal: request.signal
            });
            if (!isCurrentMapRequest(request)) return;

            setResult("카카오 지도를 불러오는 중입니다...");
            await initializeMap();
            if (!isCurrentMapRequest(request)) return;

            const itemsToRender = currentMapMode === "match" ? latestMatchItems : latestIntroItems;
            setResult("주소를 좌표로 변환하는 중입니다...");
            await renderIntroMarkers(itemsToRender);
            relayoutMap();
        } catch (error) {
            if (isAbortError(error)) return;
            console.error(error);
            setResult("카카오 지도 로딩에 실패했습니다. 앱 키 또는 네트워크 상태를 확인해 주세요.");
        } finally {
            finishMapRequest(request);
        }
    }

    function closeMapModal() {
        cancelMapWork({ clearItems: true, recenter: true });
        modalEl.classList.add("hidden");
        modalEl.classList.remove("flex");
    }

    if (introOpenBtn) {
        introOpenBtn.addEventListener("click", () => openMapModal("intro"));
    }
    if (matchOpenBtn) {
        matchOpenBtn.addEventListener("click", () => openMapModal("match"));
    }
    closeBtn.addEventListener("click", closeMapModal);

    window.addEventListener("customer:introRowsUpdated", (event) => {
        const items = Array.isArray(event?.detail?.items) ? event.detail.items : [];
        latestIntroItems = normalizeIntroItems(items);
        if (!mapInitialized) return;
        if (modalEl.classList.contains("hidden")) return;
        if (currentMapMode !== "intro") return;
        refreshIntroMarkers("intro", latestIntroItems);
    });

    modalEl.addEventListener("click", (event) => {
        if (event.target === modalEl) closeMapModal();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (modalEl.classList.contains("hidden")) return;
        closeMapModal();
    });
})();
