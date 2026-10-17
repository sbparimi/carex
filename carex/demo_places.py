"""SYNTHETIC DEMO PLACES: 20 clinic locations for each of the 56 states and territories. The first city in each list is the headquarters location, the next four are the
prominent locations, the rest are other locations. Clinic names and addresses are invented; only the city names are real. "Name/City" gives a neighbourhood inside a city;
"City@C" overrides the state's default time zone (P Pacific, M Mountain, C Central, E Eastern)."""
from __future__ import annotations

ZONES = {"P": "America/Los_Angeles", "M": "America/Denver", "C": "America/Chicago", "E": "America/New_York", "A": "America/Phoenix", "K": "America/Anchorage", "H": "Pacific/Honolulu",
         "AT": "America/Puerto_Rico", "AS": "Pacific/Pago_Pago", "GU": "Pacific/Guam", "MP": "Pacific/Saipan", "VI": "America/St_Thomas"}

PLACES: dict[str, tuple[str, str]] = {
    "AL": ("C", "Birmingham,Montgomery,Huntsville,Mobile,Tuscaloosa,Hoover,Dothan,Auburn,Decatur,Madison,Florence,Gadsden,Vestavia Hills,Prattville,Phenix City,Alabaster,Bessemer,Enterprise,Opelika,Homewood"),
    "AK": ("K", "Anchorage,Fairbanks,Juneau,Wasilla,Sitka,Ketchikan,Kenai,Kodiak,Bethel,Palmer,Homer,Soldotna,Valdez,Nome,Utqiagvik,Cordova,Seward,Petersburg,Wrangell,Dillingham"),
    "AZ": ("A", "Phoenix,Tucson,Mesa,Chandler,Scottsdale,Glendale,Gilbert,Tempe,Peoria,Surprise,Yuma,Flagstaff,Goodyear,Avondale,Lake Havasu City,Casa Grande,Sierra Vista,Prescott,Maricopa,Buckeye"),
    "AR": ("C", "Little Rock,Fayetteville,Fort Smith,Springdale,Jonesboro,North Little Rock,Conway,Rogers,Pine Bluff,Bentonville,Hot Springs,Benton,Texarkana,Sherwood,Jacksonville,Russellville,Bella Vista,West Memphis,Paragould,Cabot"),
    "CA": ("P", "San Francisco,Los Angeles,San Diego,San Jose,Sacramento,Santa Clara,San Bernardino,Oakland,Fresno,Long Beach,Irvine,Bakersfield,Anaheim,Riverside,Stockton,Santa Barbara,Pasadena,Palo Alto,Santa Rosa,Berkeley"),
    "CO": ("M", "Denver,Colorado Springs,Aurora,Fort Collins,Boulder,Lakewood,Thornton,Arvada,Westminster,Pueblo,Centennial,Greeley,Longmont,Loveland,Grand Junction,Broomfield,Castle Rock,Parker,Littleton,Durango"),
    "CT": ("E", "Hartford,New Haven,Stamford,Bridgeport,Waterbury,Norwalk,Danbury,New Britain,Greenwich,Bristol,Meriden,West Hartford,Milford,Middletown,Norwich,Shelton,Torrington,Manchester,Fairfield,Westport"),
    "DE": ("E", "Wilmington,Dover,Newark,Middletown,Smyrna,Milford,Seaford,Georgetown,Elsmere,New Castle,Clayton,Lewes,Millsboro,Laurel,Harrington,Camden,Rehoboth Beach,Bear,Hockessin,Selbyville"),
    "DC": ("E", "Downtown/Washington,Capitol Hill/Washington,Georgetown/Washington,Dupont Circle/Washington,Adams Morgan/Washington,Foggy Bottom/Washington,Shaw/Washington,Navy Yard/Washington,"
                "Columbia Heights/Washington,U Street/Washington,Brookland/Washington,Anacostia/Washington,Tenleytown/Washington,Cleveland Park/Washington,Petworth/Washington,Logan Circle/Washington,"
                "Penn Quarter/Washington,Woodley Park/Washington,Chevy Chase/Washington,Takoma/Washington"),
    "FL": ("E", "Miami,Orlando,Tampa,Jacksonville,Tallahassee,Fort Lauderdale,St. Petersburg,Hialeah,Gainesville,Sarasota,Naples,Pensacola@C,Cape Coral,West Palm Beach,Boca Raton,Daytona Beach,Fort Myers,Lakeland,Clearwater,Key West"),
    "GA": ("E", "Atlanta,Savannah,Augusta,Columbus,Macon,Athens,Sandy Springs,Roswell,Albany,Marietta,Alpharetta,Warner Robins,Valdosta,Johns Creek,Smyrna,Dunwoody,Peachtree City,Rome,Gainesville,Brunswick"),
    "HI": ("H", "Honolulu,Hilo,Kailua-Kona,Kapolei,Pearl City,Kahului,Lihue,Waipahu,Kaneohe,Wailuku,Mililani,Kihei,Lahaina,Kailua,Aiea,Waimea,Princeville,Haleiwa,Hanapepe,Pahoa"),
    "ID": ("M", "Boise,Meridian,Nampa,Idaho Falls,Pocatello,Caldwell,Coeur d'Alene@P,Twin Falls,Lewiston@P,Post Falls@P,Rexburg,Eagle,Moscow@P,Kuna,Ammon,Chubbuck,Hayden@P,Mountain Home,Blackfoot,Garden City"),
    "IL": ("C", "Chicago,Springfield,Naperville,Aurora,Rockford,Joliet,Peoria,Elgin,Champaign,Evanston,Schaumburg,Bloomington,Decatur,Waukegan,Oak Park,Skokie,Cicero,Arlington Heights,Urbana,Carbondale"),
    "IN": ("E", "Indianapolis,Fort Wayne,Evansville@C,South Bend,Carmel,Fishers,Bloomington,Hammond@C,Gary@C,Lafayette,Muncie,Terre Haute,Kokomo,Noblesville,Anderson,Elkhart,Mishawaka,Greenwood,Jeffersonville,Columbus"),
    "IA": ("C", "Des Moines,Cedar Rapids,Davenport,Sioux City,Iowa City,Waterloo,Ames,West Des Moines,Council Bluffs,Dubuque,Ankeny,Urbandale,Cedar Falls,Marion,Bettendorf,Mason City,Clinton,Burlington,Ottumwa,Fort Dodge"),
    "KS": ("C", "Wichita,Overland Park,Kansas City,Topeka,Olathe,Lawrence,Shawnee,Manhattan,Lenexa,Salina,Hutchinson,Leavenworth,Leawood,Dodge City,Garden City,Emporia,Junction City,Derby,Prairie Village,Hays"),
    "KY": ("E", "Louisville,Lexington,Bowling Green@C,Owensboro@C,Covington,Richmond,Georgetown,Florence,Hopkinsville@C,Nicholasville,Elizabethtown,Henderson@C,Frankfort,Jeffersontown,Paducah@C,Ashland,Madisonville@C,Murray@C,Danville,Radcliff"),
    "LA": ("C", "New Orleans,Baton Rouge,Shreveport,Lafayette,Lake Charles,Kenner,Bossier City,Monroe,Alexandria,Houma,Slidell,Metairie,Hammond,Natchitoches,Thibodaux,Covington,Ruston,Opelousas,Mandeville,New Iberia"),
    "ME": ("E", "Portland,Augusta,Bangor,Lewiston,South Portland,Auburn,Biddeford,Sanford,Saco,Westbrook,Waterville,Brunswick,Scarborough,Presque Isle,Bath,Ellsworth,Rockland,Belfast,Kennebunk,Falmouth"),
    "MD": ("E", "Baltimore,Annapolis,Rockville,Frederick,Gaithersburg,Bowie,Hagerstown,Columbia,Silver Spring,Towson,Salisbury,Germantown,Laurel,Ocean City,Cumberland,Easton,Cambridge,Waldorf,College Park,Bethesda"),
    "MA": ("E", "Boston,Worcester,Springfield,Cambridge,Lowell,Brockton,Quincy,Lynn,New Bedford,Newton,Somerville,Framingham,Waltham,Pittsfield,Salem,Amherst,Plymouth,Fall River,Northampton,Medford"),
    "MI": ("E", "Detroit,Grand Rapids,Lansing,Ann Arbor,Flint,Dearborn,Kalamazoo,Sterling Heights,Warren,Troy,Southfield,Traverse City,Saginaw,Midland,Battle Creek,Jackson,Bay City,Muskegon,Holland,Marquette"),
    "MN": ("C", "Minneapolis,Saint Paul,Rochester,Duluth,Bloomington,Brooklyn Park,Plymouth,St. Cloud,Eagan,Woodbury,Maple Grove,Eden Prairie,Mankato,Moorhead,Burnsville,Edina,Winona,Bemidji,Brainerd,Hibbing"),
    "MS": ("C", "Jackson,Gulfport,Southaven,Biloxi,Hattiesburg,Olive Branch,Tupelo,Meridian,Greenville,Madison,Clinton,Oxford,Starkville,Columbus,Pearl,Brandon,Vicksburg,Pascagoula,Natchez,Ridgeland"),
    "MO": ("C", "Kansas City,St. Louis,Springfield,Columbia,Independence,Lee's Summit,O'Fallon,St. Joseph,St. Charles,Blue Springs,Joplin,Jefferson City,Cape Girardeau,Chesterfield,Florissant,Wentzville,Rolla,Hannibal,Sedalia,Lebanon"),
    "MT": ("M", "Billings,Missoula,Great Falls,Bozeman,Helena,Butte,Kalispell,Havre,Anaconda,Miles City,Belgrade,Livingston,Whitefish,Laurel,Lewistown,Sidney,Glendive,Hamilton,Polson,Dillon"),
    "NE": ("C", "Omaha,Lincoln,Bellevue,Grand Island,Kearney,Fremont,Norfolk,Hastings,Columbus,North Platte,Papillion,La Vista,Scottsbluff@M,South Sioux City,Beatrice,Lexington,Gering@M,Alliance@M,York,McCook"),
    "NV": ("P", "Las Vegas,Reno,Henderson,Carson City,North Las Vegas,Sparks,Elko,Mesquite,Boulder City,Fernley,Fallon,Winnemucca,Pahrump,Ely,Yerington,Minden,Gardnerville,Incline Village,Laughlin,Lovelock"),
    "NH": ("E", "Manchester,Concord,Nashua,Portsmouth,Dover,Keene,Salem,Derry,Rochester,Merrimack,Londonderry,Hudson,Laconia,Lebanon,Claremont,Exeter,Hanover,Berlin,Conway,Plymouth"),
    "NJ": ("E", "Newark,Jersey City,Trenton,Paterson,Elizabeth,Princeton,Edison,Woodbridge,Toms River,Hamilton,Clifton,Camden,Cherry Hill,Atlantic City,New Brunswick,Hoboken,Morristown,Red Bank,Montclair,Asbury Park"),
    "NM": ("M", "Albuquerque,Santa Fe,Las Cruces,Rio Rancho,Roswell,Farmington,Clovis,Hobbs,Alamogordo,Carlsbad,Gallup,Los Alamos,Taos,Deming,Las Vegas,Silver City,Los Lunas,Artesia,Ruidoso,Espanola"),
    "NY": ("E", "Manhattan/New York,Brooklyn,Queens,Bronx,Buffalo,Rochester,Albany,Syracuse,Yonkers,White Plains,Ithaca,Binghamton,Utica,Staten Island,Hempstead,Poughkeepsie,Saratoga Springs,Schenectady,Niagara Falls,Long Island City"),
    "NC": ("E", "Charlotte,Raleigh,Greensboro,Durham,Winston-Salem,Fayetteville,Cary,Wilmington,Asheville,Chapel Hill,High Point,Concord,Greenville,Gastonia,Jacksonville,Huntersville,Apex,Wake Forest,Kannapolis,Boone"),
    "ND": ("C", "Fargo,Bismarck,Grand Forks,Minot,West Fargo,Williston,Dickinson@M,Mandan,Jamestown,Wahpeton,Devils Lake,Valley City,Watford City,Grafton,Beulah,Rugby,Lisbon,Carrington,Bottineau,Hettinger@M"),
    "OH": ("E", "Columbus,Cleveland,Cincinnati,Toledo,Akron,Dayton,Canton,Youngstown,Dublin,Westerville,Mason,Hamilton,Lorain,Springfield,Kettering,Elyria,Newark,Athens,Mansfield,Findlay"),
    "OK": ("C", "Oklahoma City,Tulsa,Norman,Broken Arrow,Edmond,Lawton,Moore,Midwest City,Stillwater,Enid,Muskogee,Bartlesville,Shawnee,Yukon,Ardmore,Ponca City,Duncan,Del City,Bixby,Sapulpa"),
    "OR": ("P", "Portland,Salem,Eugene,Gresham,Hillsboro,Beaverton,Bend,Medford,Springfield,Corvallis,Albany,Tigard,Lake Oswego,Keizer,Grants Pass,Oregon City,McMinnville,Redmond,Tualatin,Ashland"),
    "PA": ("E", "Philadelphia,Pittsburgh,Harrisburg,Allentown,Erie,Reading,Scranton,Bethlehem,Lancaster,State College,York,Wilkes-Barre,Altoona,Chester,Easton,Johnstown,Williamsport,Norristown,West Chester,Doylestown"),
    "RI": ("E", "Providence,Warwick,Cranston,Pawtucket,East Providence,Woonsocket,Newport,Westerly,Bristol,Cumberland,Coventry,Johnston,North Providence,South Kingstown,Middletown,Lincoln,Smithfield,Narragansett,Barrington,Warren"),
    "SC": ("E", "Columbia,Charleston,Greenville,Myrtle Beach,Spartanburg,Rock Hill,Summerville,Mount Pleasant,Florence,Sumter,Anderson,Aiken,Hilton Head Island,Greer,Beaufort,North Charleston,Orangeburg,Lexington,Easley,Conway"),
    "SD": ("C", "Sioux Falls,Rapid City@M,Pierre,Aberdeen,Brookings,Watertown,Mitchell,Yankton,Huron,Spearfish@M,Vermillion,Brandon,Box Elder@M,Madison,Sturgis@M,Belle Fourche@M,Harrisburg,Tea,Dell Rapids,Hot Springs@M"),
    "TN": ("C", "Nashville,Memphis,Knoxville@E,Chattanooga@E,Clarksville,Murfreesboro,Franklin,Jackson,Johnson City@E,Kingsport@E,Bartlett,Hendersonville,Brentwood,Cleveland@E,Gallatin,Cookeville,Oak Ridge@E,Maryville@E,Collierville,Columbia"),
    "TX": ("C", "Houston,Dallas,Austin,San Antonio,Fort Worth,El Paso@M,Arlington,Plano,Corpus Christi,Lubbock,Irving,Laredo,Garland,Frisco,McKinney,Amarillo,Brownsville,Waco,Midland,Round Rock"),
    "UT": ("M", "Salt Lake City,Provo,West Valley City,Ogden,St. George,Orem,Sandy,Layton,Lehi,Logan,Murray,Draper,Bountiful,Park City,Cedar City,Moab,Taylorsville,Riverton,Spanish Fork,Heber City"),
    "VT": ("E", "Burlington,Montpelier,Rutland,South Burlington,Barre,Essex Junction,St. Albans,Brattleboro,Bennington,Middlebury,Stowe,Winooski,Williston,Colchester,Springfield,St. Johnsbury,Newport,Waterbury,Manchester,Norwich"),
    "VA": ("E", "Richmond,Virginia Beach,Norfolk,Arlington,Alexandria,Chesapeake,Newport News,Hampton,Roanoke,Charlottesville,Fairfax,Lynchburg,Reston,Blacksburg,Fredericksburg,Harrisonburg,Winchester,Leesburg,Williamsburg,Manassas"),
    "WA": ("P", "Seattle,Spokane,Tacoma,Vancouver,Bellevue,Kent,Everett,Renton,Olympia,Yakima,Redmond,Kirkland,Bellingham,Kennewick,Federal Way,Auburn,Pasco,Walla Walla,Wenatchee,Bremerton"),
    "WV": ("E", "Charleston,Huntington,Morgantown,Parkersburg,Wheeling,Martinsburg,Beckley,Fairmont,Clarksburg,Weirton,Lewisburg,Princeton,Bluefield,Elkins,Logan,Buckhannon,Shepherdstown,Charles Town,South Charleston,Teays Valley"),
    "WI": ("C", "Milwaukee,Madison,Green Bay,Kenosha,Racine,Appleton,Waukesha,Eau Claire,Oshkosh,Janesville,La Crosse,Sheboygan,Wausau,Fond du Lac,Brookfield,Beloit,West Allis,Stevens Point,Superior,Menasha"),
    "WY": ("M", "Cheyenne,Casper,Laramie,Gillette,Rock Springs,Sheridan,Green River,Evanston,Riverton,Cody,Jackson,Rawlins,Lander,Torrington,Powell,Douglas,Worland,Buffalo,Wheatland,Thermopolis"),
    "AS": ("AS", "Pago Pago,Tafuna,Nuuuli,Leone,Fagaalu,Utulei,Fagatogo,Aua,Malaeloa,Ofu,Tau,Aunuu,Vatia,Aoloau,Faleniu,Iliili,Pavaiai,Mesepa,Futiga,Malaeimi"),
    "GU": ("GU", "Hagatna,Dededo,Tamuning,Yigo,Mangilao,Barrigada,Santa Rita,Agat,Yona,Piti,Talofofo,Inarajan,Merizo,Umatac,Chalan Pago,Ordot,Sinajana,Asan,Harmon,Tumon"),
    "MP": ("MP", "Garapan,Chalan Kanoa,San Jose,San Antonio,Susupe,Capitol Hill,Tanapag,As Lito,Kagman,Marpi,Koblerville,Dandan,Oleai,Gualo Rai,San Roque,Songsong,Sinapalo,Tinian Village,Chalan Laulau,Papago"),
    "PR": ("AT", "San Juan,Bayamón,Carolina,Ponce,Caguas,Guaynabo,Arecibo,Mayagüez,Trujillo Alto,Fajardo,Humacao,Aguadilla,Cayey,Vega Baja,Dorado,Toa Baja,Manatí,Cabo Rojo,Isabela,Río Grande"),
    "VI": ("VI", "Charlotte Amalie,Christiansted,Frederiksted,Cruz Bay,Red Hook,Coral Bay,Savan,Sub Base,Tutu,Annas Retreat,Frenchtown,Smith Bay,Lindbergh Bay,Bolongo,Lovenlund,Kingshill,Sion Farm,Gallows Bay,Fortuna,Estate Thomas"),
}

TIERS = ("hq", "major", "major", "major", "major")        # position 0 = headquarters, 1-4 = prominent locations, the rest = other locations


def places(code: str) -> list[dict]:
    """Ordered locations for one state: name, city, time zone, tier, sort order."""
    default, raw = PLACES[code]
    out = []
    for i, item in enumerate(raw.split(",")):
        zone = default
        if "@" in item:
            item, zone = item.split("@")
        label, _, city = item.partition("/")
        out.append({"label": label, "city": city or label, "time_zone": ZONES[zone], "tier": TIERS[i] if i < len(TIERS) else "other", "sort_order": i})
    return out
