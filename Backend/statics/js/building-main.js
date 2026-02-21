let currentPage = 1;
let currentAddress = '';
let currentcategory = '';
let currentSearchMode = 'building';
let customerSearchCache = [];
let currentBuildingTotalPages = null;
const BUILDING_PAGE_SIZE = 15;
const pageGroupSize = 5;

function setStatusOptions(mode) {
    const statusSelect = document.getElementById('statusSelect');
    if (!statusSelect) return;

    if (mode === 'customer') {
        statusSelect.innerHTML = `
            <option value="">전체</option>
            <option value="검토">검토</option>
            <option value="집중">집중</option>
            <option value="완료">완료</option>
            <option value="보류">보류</option>
        `;
        return;
    }

    statusSelect.innerHTML = `
        <option value="">전체</option>
        <option value="준비">준비</option>
        <option value="완료">완료</option>
        <option value="매각">매각</option>
        <option value="보류">보류</option>
    `;
}

function filterByStatus() {
    if (currentSearchMode === 'customer') {
        renderCustomerCards(customerSearchCache);
        return;
    }
    search();
}

function toggleAdvancedFilterPanel() {
    const panel = document.getElementById('advancedFilterPanel');
    const toggle = document.getElementById('advancedFilterToggle');
    if (!panel || !toggle) return;
    const isClosed = panel.classList.contains('-translate-x-full');
    panel.classList.toggle('-translate-x-full', !isClosed);
    toggle.textContent = isClosed ? '>' : '<';
}

function resetAdvancedFilters() {
    const panel = document.getElementById('advancedFilterPanel');
    if (!panel) return;
    panel.querySelectorAll('input').forEach((el) => {
        if (el.type === 'checkbox') el.checked = false;
        else el.value = '';
    });
    panel.querySelectorAll('select').forEach((el) => {
        if (el.id === 'matchBuildingStatus') el.value = '전체';
        else el.value = '';
    });
}

function collectAdvancedFilters() {
    const get = (id) => document.getElementById(id)?.value?.trim() || '';
    const numeric = (id) => (get(id) || '').replace(/[^0-9.]/g, '');
    return {
        address: get('matchAddressInput'),
        site_location: get('matchBusinessAreaInput'),
        station_keyword: get('matchStationKeyword'),
        station_walk_min: numeric('matchStationWalkMin'),
        station_walk_max: numeric('matchStationWalkMax'),
        cash_hold_manwon: numeric('matchCashHoldManwon'),
        cash_hold_percent: numeric('matchCashHoldPercent'),
        min_price: numeric('matchMinPrice'),
        max_price: numeric('matchMaxPrice'),
        min_yield: numeric('matchMinYieldInput'),
        land_pp_min: numeric('matchLandPyeongMin'),
        land_pp_max: numeric('matchLandPyeongMax'),
        gross_pp_min: numeric('matchGrossPyeongMin'),
        gross_pp_max: numeric('matchGrossPyeongMax'),
        land_area_min: numeric('matchLandAreaMin'),
        land_area_max: numeric('matchLandAreaMax'),
        gross_area_min: numeric('matchGrossAreaMin'),
        gross_area_max: numeric('matchGrossAreaMax'),
        usable_area_min: numeric('matchUsableAreaMin'),
        usable_area_max: numeric('matchUsableAreaMax'),
        building_area_min: numeric('matchBuildingAreaMin'),
        building_area_max: numeric('matchBuildingAreaMax'),
        approval_year_min: numeric('matchApprovalYearMin'),
        road_width_min: numeric('matchRoadWidthMin'),
        parking_min: numeric('matchParkingMin'),
        elevator_option: get('matchElevatorOption'),
        building_status: get('matchBuildingStatus'),
        location_decide: get('matchLocationDecide'),
        price_decide: get('matchPriceDecide'),
        yield_decide: get('matchYieldDecide'),
        vacancy_decide: get('matchVacancyDecide'),
        limit_decide: get('matchLimitDecide'),
        loan_decide: get('matchLoanDecide'),
        types: Array.from(document.querySelectorAll('input[name="matchType"]:checked')).map((el) => el.value).join(','),
        zoning_categories: Array.from(document.querySelectorAll('input[name="matchZoningCategory"]:checked')).map((el) => el.value).join(','),
        usage_categories: Array.from(document.querySelectorAll('input[name="matchUsageCategory"]:checked')).map((el) => el.value).join(','),
    };
}

function hasAdvancedFilters() {
    const f = collectAdvancedFilters();
    if (f.building_status && f.building_status !== '전체') return true;
    return Object.entries(f).some(([k, v]) => k !== 'building_status' && String(v || '').trim() !== '');
}

function applyAdvancedFilters() {
    currentPage = 1;
    currentAddress = document.getElementById('addressInput').value;
    currentcategory = document.getElementById('statusSelect').value;
    fetchBuildings(currentPage, currentcategory);
}

function search() {
    currentPage = 1;
    currentAddress = document.getElementById('addressInput').value;
    currentcategory = document.getElementById('statusSelect').value;
    fetchBuildings(currentPage , currentcategory);
}

function unifiedSearch() {
    const select = document.getElementById('searchTypeSelect');
    const mode = select ? select.value : 'building';
    currentSearchMode = mode;
    setStatusOptions(mode);
    if (mode === 'customer') {
        searchCustomer();
        return;
    }
    search();
}

function renderCustomerCards(data) {
    const list = document.getElementById('addressList');
    const selectedStatus = document.getElementById('statusSelect')?.value || '';
    const filtered = Array.isArray(data)
        ? data.filter((item) => !selectedStatus || (item.status || '') === selectedStatus)
        : [];

    if (!filtered.length) {
        document.getElementById("totalCount").innerText = "전체: 0건";
        list.innerHTML = '<div class="text-center text-slate-400 py-20">고객 검색 결과가 없습니다.</div>';
        return;
    }

    document.getElementById("totalCount").innerText = `전체: ${formatNumberWithComma(filtered.length)}건`;

    const customerCards = filtered.map((item) => {
        const desiredPrice = item.desired_price_manwon
            ? `${formatNumberWithComma(String(item.desired_price_manwon))}만원`
            : '-';
        const customerStateMap = {
            A: 'A(원활) : 최근 7일 이내 소통, 실행력 높은 매수자',
            B: 'B(보통) : 반응은 있으나 느림, 조건 제한 많음',
            C: 'C(어려움) : 응답 지연, 반복 제안에도 무반응',
            X: 'X(비활성) : 3개월 초과 미접촉, 제외 대상'
        };
        const customerStateText = customerStateMap[item.customer_state] || '-';

        return `
            <div onclick="goToCustomer(${item.customer_number})"
                 class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer group">
                <div class="flex justify-between items-start gap-3 mb-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                            CUSTOMER: ${item.customer_number}
                        </span>
                        <span class="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                            진행상황: ${item.status || '-'}
                        </span>
                        <span class="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded">
                            상태: ${customerStateText}
                        </span>
                    </div>
                    <span class="text-slate-300 group-hover:text-emerald-600 text-sm shrink-0">
                        고객 상세로 이동
                    </span>
                </div>
                <div class="grid grid-cols-3 gap-2 text-sm text-slate-600">
                    <p>회사명: ${item.buyer_name || '-'}</p>
                    <p>대표자: ${item.ceo_name || '-'}</p>
                    <p>연락처: ${item.phone || '-'}</p>
                    <p>이메일: ${item.email || '-'}</p>
                    <p>유입경로: ${item.first_contact || '-'}</p>
                    <p>매매가: ${desiredPrice}</p>
                    <p>상권: ${item.business_area || '-'}</p>
                    <p>건물: ${item.building_preference || '-'}</p>
                    <p>주 관심지역: ${item.main_interest_region || '-'}</p>
                </div>
            </div>
        `;
    });

    list.innerHTML = customerCards.join('');
}

function renderBuildingCards(items) {
    const list = document.getElementById('addressList');
    list.innerHTML = '';

    items.forEach(item => {
        const card = `
            <div onclick="goToDetail('${item.bd_number}')"
                 class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group">
                <div class="flex justify-between items-start">
                    <span class="text-xs font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded">
                        ID: ${item.bd_number}
                    </span>
                    <span class="text-xs font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded">
                    FLAG: ${
                        [item.location_decide,
                        item.price_decide,
                        item.yield_decide,
                        item.vacancy_decide,
                        item.limit_decide,
                        item.loan_decide]
                        .map(v => v === "선택" ? "N" : v)
                        .join("")
                    }
                    </span>
                    <span class="text-slate-300 group-hover:text-blue-500 text-sm">
                        새 창에서 상세정보 ↗
                    </span>
                </div>
                <p class="text-lg font-semibold text-slate-700">
                    주소: ${item.address || '정보 없음'}
                </p>
                <div class="grid grid-cols-4 gap-2">
                    <p class="text-sm text-slate-500">건물명: ${item.bd_name || '-'}</p>
                    <p class="text-sm text-slate-500">매매가: ${item.sale_price || '0'}</p>
                    <p class="text-sm text-slate-500">상태: ${item.status || '준비'}</p>
                    <p class="text-sm text-slate-500">수익률: ${item.yield_rate || '0'}</p>
                    <p class="text-sm text-slate-500">대지 평: ${item.land_area_pyeong || '0'}평</p>
                    <p class="text-sm text-slate-500">연면적 평: ${item.gross_area_pyeong || '0'}평</p>
                    <p class="text-sm text-slate-500">용도지역(토지): ${item.zoning_type || '-'}</p>
                    <p class="text-sm text-slate-500">승인날짜: ${item.approval_date || '-'}</p>
                    <p class="text-sm text-slate-500">승강기: ${item.elevator || '-'}</p>
                    <p class="text-sm text-slate-500">주차대수: ${item.parking_capacity || '-'}</p>
                </div>
            </div>
        `;
        list.innerHTML += card;
    });
}

async function fetchBuildingsAdvanced(page, category) {
    const list = document.getElementById('addressList');
    const loading = document.getElementById('loading');
    const pagination = document.getElementById('pagination');
    const advanced = collectAdvancedFilters();

    list.innerHTML = '';
    pagination.innerHTML = '';
    loading.classList.remove('hidden');

    const params = new URLSearchParams();
    params.set('building_page', String(page));
    params.set('page_size', '20');
    params.set('address', advanced.address || currentAddress || '');
    if (advanced.site_location) params.set('site_location', advanced.site_location);
    if (advanced.station_keyword) params.set('station_keyword', advanced.station_keyword);
    if (advanced.station_walk_min) params.set('station_walk_min', advanced.station_walk_min);
    if (advanced.station_walk_max) params.set('station_walk_max', advanced.station_walk_max);
    if (advanced.cash_hold_manwon) params.set('cash_hold_manwon', advanced.cash_hold_manwon);
    if (advanced.cash_hold_percent) params.set('cash_hold_percent', advanced.cash_hold_percent);
    if (advanced.min_price) params.set('min_price', advanced.min_price);
    if (advanced.max_price) params.set('max_price', advanced.max_price);
    if (advanced.min_yield) params.set('min_yield', advanced.min_yield);
    if (advanced.land_pp_min) params.set('land_pp_min', advanced.land_pp_min);
    if (advanced.land_pp_max) params.set('land_pp_max', advanced.land_pp_max);
    if (advanced.gross_pp_min) params.set('gross_pp_min', advanced.gross_pp_min);
    if (advanced.gross_pp_max) params.set('gross_pp_max', advanced.gross_pp_max);
    if (advanced.land_area_min) params.set('land_area_min', advanced.land_area_min);
    if (advanced.land_area_max) params.set('land_area_max', advanced.land_area_max);
    if (advanced.gross_area_min) params.set('gross_area_min', advanced.gross_area_min);
    if (advanced.gross_area_max) params.set('gross_area_max', advanced.gross_area_max);
    if (advanced.usable_area_min) params.set('usable_area_min', advanced.usable_area_min);
    if (advanced.usable_area_max) params.set('usable_area_max', advanced.usable_area_max);
    if (advanced.building_area_min) params.set('building_area_min', advanced.building_area_min);
    if (advanced.building_area_max) params.set('building_area_max', advanced.building_area_max);
    if (advanced.approval_year_min) params.set('approval_year_min', advanced.approval_year_min);
    if (advanced.road_width_min) params.set('road_width_min', advanced.road_width_min);
    if (advanced.parking_min) params.set('parking_min', advanced.parking_min);
    if (advanced.elevator_option) params.set('elevator_option', advanced.elevator_option);
    const mergedBuildingStatus = (advanced.building_status && advanced.building_status !== '전체')
        ? advanced.building_status
        : (category || '');
    params.set('building_status', mergedBuildingStatus);
    if (advanced.location_decide) params.set('location_decide', advanced.location_decide);
    if (advanced.price_decide) params.set('price_decide', advanced.price_decide);
    if (advanced.yield_decide) params.set('yield_decide', advanced.yield_decide);
    if (advanced.vacancy_decide) params.set('vacancy_decide', advanced.vacancy_decide);
    if (advanced.limit_decide) params.set('limit_decide', advanced.limit_decide);
    if (advanced.loan_decide) params.set('loan_decide', advanced.loan_decide);
    if (advanced.types) params.set('types', advanced.types);
    if (advanced.zoning_categories) params.set('zoning_categories', advanced.zoning_categories);
    if (advanced.usage_categories) params.set('usage_categories', advanced.usage_categories);

    try {
        const res = await fetch(`/api/insight/overview?${params.toString()}`);
        const data = await res.json();
        loading.classList.add('hidden');

        const items = Array.isArray(data?.buildings) ? data.buildings : [];
        if (!items.length) {
            document.getElementById("totalCount").innerText = "전체: 0건";
            list.innerHTML = '<div class="text-center text-slate-400 py-20">검색 결과가 없습니다.</div>';
            return;
        }

        currentBuildingTotalPages = Number(data?.buildings_total_pages || 0);
        renderBuildingCards(items);
        renderPagination(page, Number(data?.buildings_total_count || items.length), currentBuildingTotalPages);
    } catch (err) {
        loading.classList.add('hidden');
        console.error(err);
        list.innerHTML = '<div class="text-center text-red-400 py-20">데이터를 가져오는데 실패했습니다.</div>';
    }
}

async function searchCustomer() {
    const keyword = document.getElementById('addressInput').value.trim();
    const list = document.getElementById('addressList');
    const loading = document.getElementById('loading');
    const pagination = document.getElementById('pagination');

    list.innerHTML = '';
    pagination.innerHTML = '';
    loading.classList.remove('hidden');

    try {
        const res = await fetch(`/api/customer/search?q=${encodeURIComponent(keyword)}`);
        const data = await res.json();
        customerSearchCache = Array.isArray(data) ? data : [];
        loading.classList.add('hidden');
        renderCustomerCards(customerSearchCache);
        return;

        data.forEach(item => {
            const card = `
                <div onclick="goToCustomer(${item.customer_number})"
                     class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer group">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                            CUSTOMER: ${item.customer_number}
                        </span>
                        <span class="text-slate-300 group-hover:text-emerald-600 text-sm">
                            고객 상세로 이동
                        </span>
                    </div>
                    <p class="text-lg font-semibold text-slate-700 mb-2">
                        회사명: ${item.buyer_name || '-'}
                    </p>
                    <div class="grid grid-cols-2 gap-2">
                        <p class="text-sm text-slate-500">전화번호: ${item.phone || '-'}</p>
                        <p class="text-sm text-slate-500">상태: ${item.status || '-'}</p>
                        <p class="text-sm text-slate-500 col-span-2">회사주소: ${item.company_address || '-'}</p>
                    </div>
                </div>
            `;
            list.innerHTML += card;
        });
    } catch (err) {
        loading.classList.add('hidden');
        console.error(err);
        list.innerHTML = '<div class="text-center text-red-400 py-20">고객 데이터를 불러오는데 실패했습니다.</div>';
    }
}

// 
async function fetchBuildings(page , category) {
    if (hasAdvancedFilters()) {
        await fetchBuildingsAdvanced(page, category);
        return;
    }

    const list = document.getElementById('addressList');
    const loading = document.getElementById('loading');
    const pagination = document.getElementById('pagination');

    list.innerHTML = '';
    pagination.innerHTML = '';
    loading.classList.remove('hidden');


    try {
        const res = await fetch('/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: currentAddress, page : page , category: category})
        });

        const data = await res.json();
        loading.classList.add('hidden');

        if (!data || data.length === 0) {
            list.innerHTML = '<div class="text-center text-slate-400 py-20">검색 결과가 없습니다.</div>';
            return;
        }
        currentBuildingTotalPages = null;
        renderBuildingCards(data.slice(1));

        const totalCount = data.length > 0 ? data[0].total_count : 0;
        currentBuildingTotalPages = totalCount > 0 ? Math.ceil(totalCount / BUILDING_PAGE_SIZE) : 0;
        renderPagination(page, totalCount, currentBuildingTotalPages);

    } catch (err) {
        loading.classList.add('hidden');
        console.error(err);
        list.innerHTML = '<div class="text-center text-red-400 py-20">데이터를 가져오는데 실패했습니다.</div>';
    }
}

function renderPagination(page , item_count, total_pages = null) {
    const pagination = document.getElementById('pagination');
    const start = Math.floor((page - 1) / pageGroupSize) * pageGroupSize + 1;
    const total_count = item_count;

    if (total_count === 0) {
        document.getElementById("totalCount").innerText = "전체: 0건";
        return;
    }
    const total_count_comma = formatNumberWithComma(total_count)
    document.getElementById("totalCount").innerText = `전체: ${total_count_comma}건`;


    if (start > 1) {
        pagination.innerHTML += `
            <button onclick="goPage(${start - 1})"
                class="px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600">
                이전
            </button>
        `;
    }

    const end = total_pages && total_pages > 0
        ? Math.min(start + pageGroupSize - 1, total_pages)
        : start + pageGroupSize - 1;

    for (let i = start; i <= end; i++) {
        const active = i === page
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50';

        pagination.innerHTML += `
            <button onclick="goPage(${i})"
                class="w-10 h-10 border rounded-lg font-medium ${active}">
                ${i}
            </button>
        `;
    }

    if (!total_pages || page < total_pages) {
        pagination.innerHTML += `
            <button onclick="goPage(${start + pageGroupSize})"
                class="px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600">
                다음
            </button>
        `;
    }
}

function goPage(p) {
    const safePage = currentBuildingTotalPages && currentBuildingTotalPages > 0
        ? Math.min(Math.max(1, p), currentBuildingTotalPages)
        : Math.max(1, p);
    currentPage = safePage;
    fetchBuildings(safePage,currentcategory);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToDetail(id) {
    const win = window.open(`/detail/${id}`, '_blank');
    // 새 창 로드 후 상태 전달
    win.onload = () => {
        win.sidebarLocked = isLocked;
    };
}

// 새로운 건물 추가
function CreateBuilding(){
    window.open(`/detail/new`, '_blank');
}

// 새로운 고객 추가
function CreateCustomer(){
    window.open(`/customer/new`, '_blank');
}

function goToCustomer(id) {
    window.open(`/customer/${id}`, '_blank');
}

// 콤마 변경 
function formatNumberWithComma(value) {
    if (value === null || value === undefined) return '';

    // 🔑 먼저 문자열로 변환 (number 방어)
    const str = String(value);

    // 숫자가 아닌 문자는 제거
    const number = str.replace(/[^0-9]/g, '');

    // 콤마 추가
    return number.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 블러 여부 
window.isLocked = false;
function toggleSidebarLock() {
    window.isLocked = !window.isLocked;
    const btn = document.getElementById("lockBtn");
    if (window.isLocked){
        btn.innerText = "🔒 잠금";
    }
    else{
        btn.innerText = "🔓 해제";
    }
}



// DOM 로드 후 이벤트 바인딩
document.addEventListener('DOMContentLoaded', () => {
    const searchBar = document.getElementById('addressInput')?.parentElement;
    const buildingBtn = searchBar?.querySelector('button[onclick="search()"]');
    const customerBtn = searchBar?.querySelector('button[onclick="searchCustomer()"]');

    if (searchBar && buildingBtn && customerBtn) {
        const searchTypeSelect = document.createElement('select');
        searchTypeSelect.id = 'searchTypeSelect';
        searchTypeSelect.className = 'px-3 py-3 border border-slate-300 rounded-xl bg-white text-slate-700 font-semibold focus:ring-2 focus:ring-blue-500 focus:outline-none';

        const buildingOption = document.createElement('option');
        buildingOption.value = 'building';
        buildingOption.textContent = '검색하기';
        buildingOption.selected = true;

        const customerOption = document.createElement('option');
        customerOption.value = 'customer';
        customerOption.textContent = '고객검색';

        searchTypeSelect.appendChild(buildingOption);
        searchTypeSelect.appendChild(customerOption);

        searchBar.insertBefore(searchTypeSelect, buildingBtn);
        searchTypeSelect.addEventListener('change', (e) => {
            currentSearchMode = e.target.value;
            setStatusOptions(currentSearchMode);
        });
        buildingBtn.setAttribute('onclick', 'unifiedSearch()');
        buildingBtn.textContent = '검색';
        customerBtn.classList.add('hidden');
    }

    setStatusOptions('building');
    currentSearchMode = 'building';

    document.getElementById('addressInput')
        .addEventListener('keydown', e => {
            if (e.key === 'Enter') unifiedSearch();
        });

    const advApplyBtn = document.getElementById('advancedFilterApplyBtn');
    if (advApplyBtn) advApplyBtn.addEventListener('click', applyAdvancedFilters);

    const advResetBtn = document.getElementById('advancedFilterResetBtn');
    if (advResetBtn) advResetBtn.addEventListener('click', resetAdvancedFilters);
});
