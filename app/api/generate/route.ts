import { NextResponse } from 'next/server';
import { getCompanyProfile } from '../../utils/finnhub';
import { getDailyTimeSeries } from '../../utils/alphavantage';
import { getCompanyNews } from '../../utils/finnhub';
import { formatDateYYYYMMDD } from '../../utils/finnhub';
import { generateScript, isOllamaAvailable } from '../../utils/ollama';

interface NewsArticle {
  date: string;
  headline: string;
  source: string;
  summary?: string;
}

interface VolumeDay {
  date: string;
  price_range: {
    low: string;
    high: string;
  };
  close: string;
  change_percentage: string;
  news: NewsArticle[];
}

interface PromptContext {
  company: {
    symbol: string;
    name: string;
    sector: string;
    industry: string;
    description: string;
  };
  analysis_period: {
    timeframe: string;
    start_date: string;
    end_date: string;
  };
  high_volume_events: VolumeDay[];
}

// Mock script generation - in a real application, this would use:
// 1. Real stock data from an API
// 2. LLM for script generation
// 3. Proper error handling and rate limiting
function generateMockScript(context: any): string {
  const { company, analysis_period, high_volume_events } = context;
  
  // Add null checks and default values
  const sector = company?.sector || 'technology';
  const industry = company?.industry || 'technology';
  const companyName = company?.name || company?.symbol || 'the company';
  
  // Calculate overall price movement
  const firstDay = high_volume_events[high_volume_events.length - 1] as VolumeDay;
  const lastDay = high_volume_events[0] as VolumeDay;
  const totalChange = ((parseFloat(lastDay.close) - parseFloat(firstDay.close)) / parseFloat(firstDay.close) * 100).toFixed(2);
  
  // Find the most dramatic move
  const dramaticMove = high_volume_events.reduce((max: VolumeDay, day: VolumeDay) => {
    const change = Math.abs(parseFloat(day.change_percentage));
    return change > Math.abs(parseFloat(max.change_percentage)) ? day : max;
  }, high_volume_events[0]);

  return `
In the ${sector} sector, ${companyName} has been drawing significant market attention, showing a ${parseFloat(totalChange) >= 0 ? 'positive' : 'negative'} ${Math.abs(parseFloat(totalChange))}% movement over this period. The most dramatic shift saw the stock ${parseFloat(dramaticMove.change_percentage) >= 0 ? 'surge' : 'plunge'} by ${Math.abs(parseFloat(dramaticMove.change_percentage))}%. [...]

${(high_volume_events as VolumeDay[])
  .filter(day => Math.abs(parseFloat(day.change_percentage)) > 1.5) // Only include significant moves
  .map((day: VolumeDay, index: number, filteredArray: VolumeDay[]) => {
    const moveDesc = parseFloat(day.change_percentage) >= 0 
      ? ['climbed', 'rallied', 'advanced'][Math.floor(Math.random() * 3)]
      : ['declined', 'retreated', 'pulled back'][Math.floor(Math.random() * 3)];
    
    const magnitude = Math.abs(parseFloat(day.change_percentage)) > 3 
      ? 'dramatic' 
      : Math.abs(parseFloat(day.change_percentage)) > 2 
        ? 'significant'
        : 'notable';

    const transition = index === 0 
      ? 'The period began as'
      : index === filteredArray.length - 1
        ? 'The final significant move came when'
        : ['Following this', 'In a subsequent reaction', 'The momentum continued as'][Math.floor(Math.random() * 3)];

    const relevantNews = day.news
      .filter(article => article.summary && article.summary.length > 50)
      .slice(0, 2)
      .map(article => article.headline + (article.summary ? '. ' + article.summary : ''))
      .join(' ');

    return relevantNews 
      ? `${transition} the stock ${moveDesc} by ${Math.abs(parseFloat(day.change_percentage))}% in ${magnitude} trading. ${relevantNews}`
      : '';
  })
  .filter(text => text.length > 0)
  .join('\n\n[...]\n\n')}

[...]

Analysis of these price movements reveals that ${companyName}'s stock is particularly sensitive to ${sector.toLowerCase()} sector developments and company-specific announcements. The market has shown a pattern of ${Math.abs(parseFloat(totalChange)) > 10 ? 'strong' : 'measured'} reactions to news about ${
    (high_volume_events as VolumeDay[])
      .flatMap((day: VolumeDay) => day.news)
      .some((news: NewsArticle) => news.headline?.toLowerCase().includes('earnings'))
      ? 'earnings reports and '
      : ''
  }${industry.toLowerCase()} trends.

For investors watching ${company?.symbol || 'this stock'}, the key takeaways are clear:
1. News about ${sector.toLowerCase()} sector developments tends to trigger ${Math.abs(parseFloat(dramaticMove.change_percentage)) > 5 ? 'significant' : 'notable'} price movements
2. The stock has shown ${Math.abs(parseFloat(totalChange)) > 15 ? 'high' : 'moderate'} sensitivity to industry-wide trends
3. Market sentiment appears to be particularly focused on ${
    (high_volume_events as VolumeDay[])
      .flatMap((day: VolumeDay) => day.news)
      .some((news: NewsArticle) => news.headline?.toLowerCase().includes('ai'))
      ? 'AI developments and '
      : ''
  }competitive positioning within the ${industry.toLowerCase()} space`.trim();
}

// Rename to fallbackGenerateScript
function fallbackGenerateScript(context: PromptContext): string {
  const { company, analysis_period, high_volume_events } = context;
  
  // Add null checks and default values
  const sector = company?.sector || 'technology';
  const industry = company?.industry || 'technology';
  const companyName = company?.name || company?.symbol || 'the company';
  
  // Calculate overall price movement
  const firstDay = high_volume_events[high_volume_events.length - 1];
  const lastDay = high_volume_events[0];
  const totalChange = ((parseFloat(lastDay.close) - parseFloat(firstDay.close)) / parseFloat(firstDay.close) * 100).toFixed(2);
  
  // Find the most dramatic move
  const dramaticMove = high_volume_events.reduce((max: VolumeDay, day: VolumeDay) => {
    const change = Math.abs(parseFloat(day.change_percentage));
    return change > Math.abs(parseFloat(max.change_percentage)) ? day : max;
  }, high_volume_events[0]);

  return `
In the ${sector} sector, ${companyName} has been drawing significant market attention, showing a ${parseFloat(totalChange) >= 0 ? 'positive' : 'negative'} ${Math.abs(parseFloat(totalChange))}% movement over this period. The most dramatic shift saw the stock ${parseFloat(dramaticMove.change_percentage) >= 0 ? 'surge' : 'plunge'} by ${Math.abs(parseFloat(dramaticMove.change_percentage))}%. [...]

${high_volume_events
  .filter((day: VolumeDay) => Math.abs(parseFloat(day.change_percentage)) > 1.5) // Only include significant moves
  .map((day: VolumeDay, index: number, filteredArray: VolumeDay[]) => {
    const moveDesc = parseFloat(day.change_percentage) >= 0 
      ? ['climbed', 'rallied', 'advanced'][Math.floor(Math.random() * 3)]
      : ['declined', 'retreated', 'pulled back'][Math.floor(Math.random() * 3)];
    
    const magnitude = Math.abs(parseFloat(day.change_percentage)) > 3 
      ? 'dramatic' 
      : Math.abs(parseFloat(day.change_percentage)) > 2 
        ? 'significant'
        : 'notable';

    const transition = index === 0 
      ? 'The period began as'
      : index === filteredArray.length - 1
        ? 'The final significant move came when'
        : ['Following this', 'In a subsequent reaction', 'The momentum continued as'][Math.floor(Math.random() * 3)];

    const relevantNews = day.news
      .filter((article: NewsArticle) => article.summary && article.summary.length > 50)
      .slice(0, 2)
      .map((article: NewsArticle) => article.headline + (article.summary ? '. ' + article.summary : ''))
      .join(' ');

    return relevantNews 
      ? `${transition} the stock ${moveDesc} by ${Math.abs(parseFloat(day.change_percentage))}% in ${magnitude} trading. ${relevantNews}`
      : '';
  })
  .filter((text: string) => text.length > 0)
  .join('\n\n[...]\n\n')}

[...]

Analysis of these price movements reveals that ${companyName}'s stock is particularly sensitive to ${sector.toLowerCase()} sector developments and company-specific announcements. The market has shown a pattern of ${Math.abs(parseFloat(totalChange)) > 10 ? 'strong' : 'measured'} reactions to news about ${
    high_volume_events
      .flatMap((day: VolumeDay) => day.news)
      .some((news: NewsArticle) => news.headline?.toLowerCase().includes('earnings'))
      ? 'earnings reports and '
      : ''
  }${industry.toLowerCase()} trends.

For investors watching ${company?.symbol || 'this stock'}, the key takeaways are clear:
1. News about ${sector.toLowerCase()} sector developments tends to trigger ${Math.abs(parseFloat(dramaticMove.change_percentage)) > 5 ? 'significant' : 'notable'} price movements
2. The stock has shown ${Math.abs(parseFloat(totalChange)) > 15 ? 'high' : 'moderate'} sensitivity to industry-wide trends
3. Market sentiment appears to be particularly focused on ${
    high_volume_events
      .flatMap((day: VolumeDay) => day.news)
      .some((news: NewsArticle) => news.headline?.toLowerCase().includes('ai'))
      ? 'AI developments and '
      : ''
  }competitive positioning within the ${industry.toLowerCase()} space`.trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { symbol, timeframe } = body;

    if (!symbol || !timeframe) {
      return NextResponse.json(
        { error: 'Symbol and timeframe are required' },
        { status: 400 }
      );
    }

    // Get company profile
    const profile = await getCompanyProfile(symbol);
    if (!profile) {
      return NextResponse.json(
        { error: 'Company profile not found' },
        { status: 404 }
      );
    }

    // Get volume data
    const volumeData = await getDailyTimeSeries(symbol);
    if (!volumeData.length) {
      return NextResponse.json(
        { error: 'Volume data not found' },
        { status: 404 }
      );
    }

    // Process volume data to get top 5 volume days
    const topVolumeDays = volumeData
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);

    // Get news for each high volume day
    const volumeDaysWithNews = await Promise.all(
      topVolumeDays.map(async (day) => {
        const date = day.date;
        const threeDaysAgo = new Date(date);
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        
        const news = await getCompanyNews(
          symbol,
          formatDateYYYYMMDD(threeDaysAgo),
          date
        );

        const relevantNews = (Array.isArray(news) ? news : [])
          .filter(item => 
            item.category === 'company news' || 
            item.related?.includes(symbol) ||
            item.headline?.includes(symbol)
          )
          .slice(0, 3)
          .map(item => ({
            date: formatDateYYYYMMDD(new Date(item.datetime * 1000)),
            headline: item.headline,
            source: item.source,
            summary: item.summary
          }));

        return {
          date: day.date,
          price_range: {
            low: day.low.toFixed(2),
            high: day.high.toFixed(2)
          },
          close: day.close.toFixed(2),
          change_percentage: ((day.close - day.open) / day.open * 100).toFixed(2),
          news: relevantNews
        };
      })
    );

    // Create the prompt context
    const promptContext = {
      company: {
        symbol,
        name: profile.name,
        sector: profile.sector,
        industry: profile.industry,
        description: profile.description
      },
      analysis_period: {
        timeframe,
        start_date: volumeData[volumeData.length - 1].date,
        end_date: volumeData[0].date
      },
      high_volume_events: volumeDaysWithNews
    };

    let script: string;
    const ollamaAvailable = await isOllamaAvailable();

    if (ollamaAvailable) {
      try {
        // Convert context to a natural language prompt
        const prompt = `You are a financial analyst creating a script about ${profile.name} (${symbol}). 
Here is the context:
- Company: ${profile.name} in the ${profile.sector} sector, specifically ${profile.industry}
- Analysis Period: ${timeframe}
- Description: ${profile.description}
- Top volume days and associated news: ${JSON.stringify(volumeDaysWithNews, null, 2)}

Create a compelling narrative about the stock's performance during this period. Focus on:
1. Significant price movements and their catalysts
2. Market reaction patterns
3. Notable news events and their impact
4. Overall trends and what they mean for investors

Use dynamic language and create a flowing narrative. Avoid specific dates, instead use relative time references.
Keep the tone professional but engaging.`;

        script = await generateScript(prompt);
      } catch (error) {
        console.error('Error using Ollama, falling back to mock implementation:', error);
        script = fallbackGenerateScript(promptContext);
      }
    } else {
      console.log('Ollama not available, using mock implementation');
      script = fallbackGenerateScript(promptContext);
    }
    
    return NextResponse.json({ script });
  } catch (error) {
    console.error('Error generating script:', error);
    return NextResponse.json(
      { error: 'Failed to generate script' },
      { status: 500 }
    );
  }
} 