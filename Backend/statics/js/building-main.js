let currentPage = 1;
let currentAddress = '';
let currentcategory = '';
const pageGroupSize = 5;

function search() {
    currentPage = 1;
    currentAddress = document.getElementById('addressInput').value;
    currentcategory = document.getElementById('statusSelect').value;
    fetchBuildings(currentPage , currentcategory);
}

function unifiedSearch() {
    const select = document.getElementById('searchTypeSelect');
    const mode = select ? select.value : 'building';
    if (mode === 'customer') {
        searchCustomer();
        return;
    }
    search();
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
        loading.classList.add('hidden');

        if (!Array.isArray(data) || data.length === 0) {
            document.getElementById("totalCount").innerText = "전체: 0건";
            list.innerHTML = '<div class="text-center text-slate-400 py-20">고객 검색 결과가 없습니다.</div>';
            return;
        }

        document.getElementById("totalCount").innerText = `전체: ${formatNumberWithComma(data.length)}건`;

        const customerCards = data.map((item) => {
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
        console.log("DB search DATA")
        console.log(data)
        
        // 실질적 card 생성하는 곳 
        // slice(1) : 0번째에 해당 자료 수가 들어가기 때문에 undefine 카드 생성 막기위해
        data.slice(1).forEach(item => {
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
                        <p class="text-sm text-slate-500">연면적 평: ${item.land_area_sqm || '0'}㎡</p>
                        <p class="text-sm text-slate-500">용도지역(토지): ${item.zoning_type || '-'}</p>
                        <p class="text-sm text-slate-500">승인날짜: ${item.approval_date || '-'}</p>
                        <p class="text-sm text-slate-500">승강기: ${item.elevator || '-'}</p>
                        <p class="text-sm text-slate-500">주차대수: ${item.parking_capacity || '-'}</p>
                        
                    </div>
                </div>
            `;
            list.innerHTML += card;
        });

        const totalCount = data.length > 0 ? data[0].total_count : 0;

        renderPagination(page, totalCount );

    } catch (err) {
        loading.classList.add('hidden');
        console.error(err);
        list.innerHTML = '<div class="text-center text-red-400 py-20">데이터를 가져오는데 실패했습니다.</div>';
    }
}

function renderPagination(page , item_count) {
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

    for (let i = start; i < start + pageGroupSize; i++) {
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

    pagination.innerHTML += `
        <button onclick="goPage(${start + pageGroupSize})"
            class="px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600">
            다음
        </button>
    `;
}

function goPage(p) {
    currentPage = p;
    fetchBuildings(p,currentcategory);
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
        buildingBtn.setAttribute('onclick', 'unifiedSearch()');
        buildingBtn.textContent = '검색';
        customerBtn.classList.add('hidden');
    }

    document.getElementById('addressInput')
        .addEventListener('keydown', e => {
            if (e.key === 'Enter') unifiedSearch();
        });
});
