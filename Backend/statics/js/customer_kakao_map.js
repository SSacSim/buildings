(function () {
    const modalEl = document.getElementById("customerKakaoMapModal");
    const openBtn = document.getElementById("openCustomerKakaoMapBtn");
    const closeBtn = document.getElementById("closeCustomerKakaoMapBtn");
    const resultEl = document.getElementById("customerKakaoMapResult");
    const mapContainer = document.getElementById("customerKakaoMap");

    if (!modalEl || !openBtn || !closeBtn || !resultEl || !mapContainer) {
        return;
    }

    const KAKAO_APP_KEY = (modalEl.dataset.kakaoAppKey || "").trim();
    const DEFAULT_CENTER = { lat: 37.5662952, lng: 126.9779451 };

    let sdkPromise = null;
    let map = null;
    let geocoder = null;
    let openHoverPopup = null;
    let hoverCloseTimer = null;
    let allBounds = null;
    let hasBoundsPoint = false;
    let mapInitialized = false;
    let refreshSequence = 0;
    let latestIntroItems = [];

    const geocodeCache = new Map();
    const introMarkers = [];
    const HOVER_CLOSE_DELAY_MS = 180;

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
                const key = `${bdNumber}|${address}`;
                if (seen.has(key)) return null;
                seen.add(key);

                return {
                    bd_number: bdNumber || null,
                    bd_name: bdName,
                    address: address,
                    sale_price: salePrice,
                    detail_url: detailUrl
                };
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
        let renderedCount = 0;
        let linkableCount = 0;

        for (const item of normalized) {
            const geo = await geocodeAddress(item.address);
            if (sequence !== refreshSequence) return;
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

        fitBoundsOrCenter();
        if (renderedCount > 0) {
            setResult(`소개매물 ${renderedCount}건 표시 (상세연결 ${linkableCount}건).`);
            return;
        }
        setResult("소개 매물 주소를 좌표로 변환하지 못했습니다.");
    }

    async function refreshIntroMarkers(explicitItems) {
        const sourceItems = Array.isArray(explicitItems) ? explicitItems : getIntroItemsFromSource();
        latestIntroItems = normalizeIntroItems(sourceItems);
        if (!mapInitialized) return;
        await renderIntroMarkers(latestIntroItems);
    }

    async function openMapModal() {
        modalEl.classList.remove("hidden");
        modalEl.classList.add("flex");
        setResult("지도를 불러오는 중입니다...");

        try {
            await initializeMap();
            await refreshIntroMarkers();
            relayoutMap();
        } catch (error) {
            console.error(error);
            setResult("카카오 지도 로딩에 실패했습니다. 앱 키 또는 네트워크 상태를 확인해 주세요.");
        }
    }

    function closeMapModal() {
        modalEl.classList.add("hidden");
        modalEl.classList.remove("flex");
    }

    openBtn.addEventListener("click", openMapModal);
    closeBtn.addEventListener("click", closeMapModal);

    window.addEventListener("customer:introRowsUpdated", (event) => {
        const items = Array.isArray(event?.detail?.items) ? event.detail.items : [];
        latestIntroItems = normalizeIntroItems(items);
        if (!mapInitialized) return;
        if (modalEl.classList.contains("hidden")) return;
        refreshIntroMarkers(latestIntroItems);
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
