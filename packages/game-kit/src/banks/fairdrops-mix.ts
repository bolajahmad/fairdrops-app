import type { QuizBank } from "../games/quiz.js";

/**
 * FairDrops' built-in question bank: 100 general-knowledge questions anyone can answer without
 * special knowledge of crypto. A quiz draws its questions from here, at random from the committed
 * seed, when the host does not pick another bank. `answer` is the index of the right choice.
 */
export const fairDropsMix: QuizBank = {
  v: 1,
  name: "FairDrops mix",
  questions: [
    {
      prompt: "Which planet is known as the Red Planet?",
      choices: ["Mars", "Venus", "Jupiter", "Mercury"],
      answer: 0,
    },
    { prompt: "How many continents are there?", choices: ["5", "6", "7", "8"], answer: 2 },
    {
      prompt: "What is the largest ocean on Earth?",
      choices: ["Atlantic", "Pacific", "Indian", "Arctic"],
      answer: 1,
    },
    {
      prompt: "What gas do plants take in from the air to make food?",
      choices: ["Oxygen", "Nitrogen", "Hydrogen", "Carbon dioxide"],
      answer: 3,
    },
    {
      prompt: "How many days are in a leap year?",
      choices: ["364", "365", "366", "367"],
      answer: 2,
    },
    {
      prompt: "What is the chemical symbol for water?",
      choices: ["H2O", "CO2", "O2", "NaCl"],
      answer: 0,
    },
    {
      prompt: "Which is the longest river in Africa?",
      choices: ["Congo", "Nile", "Zambezi", "Niger"],
      answer: 1,
    },
    { prompt: "How many sides does a hexagon have?", choices: ["5", "6", "7", "8"], answer: 1 },
    {
      prompt: "What is the capital city of Nigeria?",
      choices: ["Lagos", "Kano", "Ibadan", "Abuja"],
      answer: 3,
    },
    {
      prompt: "Which animal is known as the King of the Jungle?",
      choices: ["Lion", "Tiger", "Elephant", "Leopard"],
      answer: 0,
    },
    { prompt: "What is 12 × 12?", choices: ["124", "144", "132", "154"], answer: 1 },
    {
      prompt: "What is the hardest natural substance?",
      choices: ["Gold", "Iron", "Diamond", "Quartz"],
      answer: 2,
    },
    {
      prompt: "Which planet has the most known moons?",
      choices: ["Jupiter", "Neptune", "Uranus", "Saturn"],
      answer: 3,
    },
    {
      prompt: "What do bees collect from flowers to make honey?",
      choices: ["Nectar", "Pollen", "Sap", "Dew"],
      answer: 0,
    },
    {
      prompt: "How many players are on the pitch for one football (soccer) team?",
      choices: ["9", "10", "11", "12"],
      answer: 2,
    },
    {
      prompt: "What is the boiling point of water at sea level in Celsius?",
      choices: ["90°C", "100°C", "110°C", "120°C"],
      answer: 1,
    },
    {
      prompt: "Which country is home to the pyramids of Giza?",
      choices: ["Ethiopia", "Sudan", "Morocco", "Egypt"],
      answer: 3,
    },
    {
      prompt: "What is the largest mammal in the world?",
      choices: ["Blue whale", "African elephant", "Giraffe", "Hippopotamus"],
      answer: 0,
    },
    {
      prompt: "Which colour do you get by mixing blue and yellow?",
      choices: ["Purple", "Orange", "Green", "Brown"],
      answer: 2,
    },
    { prompt: "How many hours are in a day?", choices: ["12", "20", "24", "36"], answer: 2 },
    {
      prompt: "What is the freezing point of water in Celsius?",
      choices: ["0°C", "−10°C", "10°C", "32°C"],
      answer: 0,
    },
    {
      prompt: "Which organ pumps blood around the body?",
      choices: ["Lungs", "Liver", "Kidney", "Heart"],
      answer: 3,
    },
    {
      prompt: "What is the capital of France?",
      choices: ["Lyon", "Paris", "Marseille", "Nice"],
      answer: 1,
    },
    { prompt: "How many legs does a spider have?", choices: ["6", "8", "10", "12"], answer: 1 },
    { prompt: "Which is the smallest prime number?", choices: ["0", "1", "2", "3"], answer: 2 },
    {
      prompt: "What is the main language spoken in Brazil?",
      choices: ["Spanish", "English", "French", "Portuguese"],
      answer: 3,
    },
    {
      prompt: "Which planet is closest to the Sun?",
      choices: ["Mercury", "Venus", "Earth", "Mars"],
      answer: 0,
    },
    { prompt: "How many minutes are in an hour?", choices: ["30", "60", "90", "100"], answer: 1 },
    {
      prompt: "What is the largest desert in the world by area (hot deserts)?",
      choices: ["Kalahari", "Gobi", "Arabian", "Sahara"],
      answer: 3,
    },
    {
      prompt: "Which instrument has 88 keys?",
      choices: ["Piano", "Violin", "Guitar", "Flute"],
      answer: 0,
    },
    { prompt: "What is 15% of 200?", choices: ["15", "20", "30", "35"], answer: 2 },
    {
      prompt: "Which bird is a symbol of peace?",
      choices: ["Eagle", "Owl", "Parrot", "Dove"],
      answer: 3,
    },
    {
      prompt: "What is the tallest mountain on Earth above sea level?",
      choices: ["Everest", "Kilimanjaro", "K2", "Mont Blanc"],
      answer: 0,
    },
    {
      prompt: "How many strings does a standard guitar have?",
      choices: ["4", "5", "6", "7"],
      answer: 2,
    },
    {
      prompt: "Which vitamin does the skin make in sunlight?",
      choices: ["Vitamin A", "Vitamin D", "Vitamin C", "Vitamin B12"],
      answer: 1,
    },
    {
      prompt: "What is the capital of Kenya?",
      choices: ["Mombasa", "Nakuru", "Kisumu", "Nairobi"],
      answer: 3,
    },
    {
      prompt: "Which shape has three sides?",
      choices: ["Triangle", "Square", "Pentagon", "Circle"],
      answer: 0,
    },
    { prompt: "How many weeks are in a year?", choices: ["48", "50", "52", "54"], answer: 2 },
    {
      prompt: "What do caterpillars turn into?",
      choices: ["Beetles", "Butterflies", "Bees", "Spiders"],
      answer: 1,
    },
    {
      prompt: "Which is the largest planet in our solar system?",
      choices: ["Saturn", "Neptune", "Earth", "Jupiter"],
      answer: 3,
    },
    { prompt: "What is the square root of 81?", choices: ["7", "8", "9", "10"], answer: 2 },
    {
      prompt: "Which continent is Ghana in?",
      choices: ["Africa", "Asia", "South America", "Europe"],
      answer: 0,
    },
    {
      prompt: "What is the opposite of 'ancient'?",
      choices: ["Old", "Modern", "Historic", "Antique"],
      answer: 1,
    },
    { prompt: "How many sides does a square have?", choices: ["3", "4", "5", "6"], answer: 1 },
    {
      prompt: "Which metal is liquid at room temperature?",
      choices: ["Silver", "Lead", "Tin", "Mercury"],
      answer: 3,
    },
    {
      prompt: "Who painted the Mona Lisa?",
      choices: ["Leonardo da Vinci", "Van Gogh", "Picasso", "Michelangelo"],
      answer: 0,
    },
    {
      prompt: "What is the currency of Japan?",
      choices: ["Yuan", "Won", "Yen", "Ringgit"],
      answer: 2,
    },
    {
      prompt: "How many bones does an adult human have?",
      choices: ["186", "206", "226", "246"],
      answer: 1,
    },
    {
      prompt: "Which is the fastest land animal?",
      choices: ["Lion", "Gazelle", "Horse", "Cheetah"],
      answer: 3,
    },
    { prompt: "What is 7 × 8?", choices: ["54", "56", "58", "64"], answer: 1 },
    {
      prompt: "Which ocean lies between Africa and Australia?",
      choices: ["Indian", "Pacific", "Atlantic", "Southern"],
      answer: 0,
    },
    {
      prompt: "What does a thermometer measure?",
      choices: ["Weight", "Speed", "Temperature", "Pressure"],
      answer: 2,
    },
    {
      prompt: "Which is the largest country in the world by area?",
      choices: ["Canada", "China", "USA", "Russia"],
      answer: 3,
    },
    { prompt: "How many colours are in a rainbow?", choices: ["5", "6", "7", "8"], answer: 2 },
    {
      prompt: "Which city is South Africa's legislative capital, where parliament sits?",
      choices: ["Cape Town", "Pretoria", "Johannesburg", "Durban"],
      answer: 0,
    },
    {
      prompt: "Which part of the plant takes in water from the soil?",
      choices: ["Leaves", "Stem", "Flowers", "Roots"],
      answer: 3,
    },
    { prompt: "What is 100 divided by 4?", choices: ["20", "25", "30", "40"], answer: 1 },
    {
      prompt: "Which planet is famous for its rings?",
      choices: ["Saturn", "Mars", "Venus", "Mercury"],
      answer: 0,
    },
    {
      prompt: "What is the main ingredient in guacamole?",
      choices: ["Tomato", "Pepper", "Avocado", "Onion"],
      answer: 2,
    },
    { prompt: "How many seconds are in a minute?", choices: ["30", "60", "100", "120"], answer: 1 },
    {
      prompt: "Which language has the most native speakers?",
      choices: ["English", "Spanish", "Hindi", "Mandarin Chinese"],
      answer: 3,
    },
    {
      prompt: "What is the capital of Egypt?",
      choices: ["Cairo", "Alexandria", "Luxor", "Giza"],
      answer: 0,
    },
    {
      prompt: "Which sport is played at Wimbledon?",
      choices: ["Golf", "Cricket", "Tennis", "Rugby"],
      answer: 2,
    },
    {
      prompt: "What is the largest organ of the human body?",
      choices: ["Liver", "Brain", "Heart", "Skin"],
      answer: 3,
    },
    { prompt: "How many zeros are in one million?", choices: ["5", "6", "7", "9"], answer: 1 },
    {
      prompt: "Which animal is known for changing its colour to blend in?",
      choices: ["Chameleon", "Frog", "Snake", "Turtle"],
      answer: 0,
    },
    {
      prompt: "What is the nearest star to Earth?",
      choices: ["Sirius", "Polaris", "The Sun", "Alpha Centauri"],
      answer: 2,
    },
    {
      prompt: "Which month has the fewest days?",
      choices: ["April", "June", "November", "February"],
      answer: 3,
    },
    { prompt: "What is half of 250?", choices: ["115", "120", "125", "150"], answer: 2 },
    {
      prompt: "In which country would you find the Eiffel Tower?",
      choices: ["France", "Italy", "Spain", "Belgium"],
      answer: 0,
    },
    {
      prompt: "What do you call a baby cat?",
      choices: ["Puppy", "Kitten", "Cub", "Calf"],
      answer: 1,
    },
    {
      prompt: "Which gas do humans need to breathe in to stay alive?",
      choices: ["Argon", "Carbon dioxide", "Helium", "Oxygen"],
      answer: 3,
    },
    {
      prompt: "How many players are on a basketball court for one team?",
      choices: ["4", "5", "6", "7"],
      answer: 1,
    },
    {
      prompt: "What is the capital of the United Kingdom?",
      choices: ["London", "Edinburgh", "Manchester", "Cardiff"],
      answer: 0,
    },
    {
      prompt: "Which is a primary colour of light?",
      choices: ["Yellow", "Purple", "Green", "Orange"],
      answer: 2,
    },
    { prompt: "What is 9 squared?", choices: ["18", "72", "81", "99"], answer: 2 },
    {
      prompt: "Which river flows through London?",
      choices: ["Seine", "Rhine", "Danube", "Thames"],
      answer: 3,
    },
    {
      prompt: "Which planet do we live on?",
      choices: ["Earth", "Venus", "Mars", "Saturn"],
      answer: 0,
    },
    {
      prompt: "What is the capital of Ghana?",
      choices: ["Kumasi", "Accra", "Tamale", "Takoradi"],
      answer: 1,
    },
    { prompt: "How many hearts does an octopus have?", choices: ["1", "2", "3", "4"], answer: 2 },
    {
      prompt: "Which device is used to look at very small things?",
      choices: ["Telescope", "Stethoscope", "Periscope", "Microscope"],
      answer: 3,
    },
    {
      prompt: "What is the plural of 'mouse' (the animal)?",
      choices: ["Mice", "Mouses", "Meese", "Mouse"],
      answer: 0,
    },
    {
      prompt: "Which festival is known as the festival of lights?",
      choices: ["Easter", "Diwali", "Eid al-Adha", "Thanksgiving"],
      answer: 1,
    },
    {
      prompt: "How many centimetres are in a metre?",
      choices: ["10", "100", "1,000", "10,000"],
      answer: 1,
    },
    {
      prompt: "Which planet is the hottest?",
      choices: ["Mars", "Jupiter", "Mercury", "Venus"],
      answer: 3,
    },
    {
      prompt: "What is the capital of Japan?",
      choices: ["Tokyo", "Kyoto", "Osaka", "Hiroshima"],
      answer: 0,
    },
    {
      prompt: "Which fruit is known for keeping the doctor away, according to the saying?",
      choices: ["Banana", "Orange", "Apple", "Mango"],
      answer: 2,
    },
    { prompt: "What is 3 + 4 × 2?", choices: ["11", "14", "10", "9"], answer: 0 },
    {
      prompt: "What is the outer layer of a tree called?",
      choices: ["Sap", "Root", "Leaf", "Bark"],
      answer: 3,
    },
    {
      prompt: "Which country has the largest population in Africa?",
      choices: ["Egypt", "Nigeria", "Ethiopia", "South Africa"],
      answer: 1,
    },
    { prompt: "How many sides does an octagon have?", choices: ["6", "7", "8", "10"], answer: 2 },
    {
      prompt: "Which is the coldest continent?",
      choices: ["Europe", "North America", "Asia", "Antarctica"],
      answer: 3,
    },
    {
      prompt: "What is the capital of Canada?",
      choices: ["Ottawa", "Vancouver", "Toronto", "Montreal"],
      answer: 0,
    },
    {
      prompt: "What is the dark opening in the centre of the eye called?",
      choices: ["Retina", "Pupil", "Lens", "Cornea"],
      answer: 1,
    },
    {
      prompt: "What is 1,000 grams equal to?",
      choices: ["1 tonne", "1 pound", "1 kilogram", "10 kilograms"],
      answer: 2,
    },
    {
      prompt: "Which animal lays the largest eggs?",
      choices: ["Penguin", "Eagle", "Chicken", "Ostrich"],
      answer: 3,
    },
    {
      prompt: "Which planet spins on its side, almost lying down?",
      choices: ["Uranus", "Neptune", "Mars", "Venus"],
      answer: 0,
    },
    {
      prompt: "What is the capital of Italy?",
      choices: ["Milan", "Rome", "Venice", "Naples"],
      answer: 1,
    },
    {
      prompt: "Which planet is known for its Great Red Spot storm?",
      choices: ["Saturn", "Mars", "Jupiter", "Neptune"],
      answer: 2,
    },
    {
      prompt: "How many years are in a century?",
      choices: ["10", "50", "100", "1,000"],
      answer: 2,
    },
  ],
};
