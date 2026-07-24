export default {

  categories: [

    {
      name: "Persian Popular",
      url: "https://www.instagram.com/popular/persian/?utm_source=popular_home",
      limit: 15
    },

    {
      name: "Persian Cars",
      url: "https://www.instagram.com/car/persian/?utm_source=popular_home",
      limit: 10
    }

  ],

  telegram: {

    botToken:
      process.env.TELEGRAM_BOT_TOKEN,

    channelId:
      process.env.TELEGRAM_CHANNEL_ID

  },

  browser: {

    timeout: 60000

  }

};
