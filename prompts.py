"""
This module handles loading and formatting the script generation prompt.
"""
import logging
import os
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PromptLoader:
    @staticmethod
    def load_prompt_template(period):
        """Load the appropriate prompt template based on the time period."""
        # Get the absolute path to the prompts directory
        base_dir = Path(__file__).parent
        prompts_dir = base_dir / 'prompts'
        
        # Ensure prompts directory exists
        prompts_dir.mkdir(exist_ok=True)
        
        # Determine template file path
        if period == '1mo':
            template_file = prompts_dir / 'monthly_prompt.txt'
        else:
            template_file = prompts_dir / 'long_term_prompt.txt'
        
        try:
            # Check if template file exists
            if not template_file.exists():
                logger.error(f"Template file not found: {template_file}")
                raise FileNotFoundError(f"Template file not found: {template_file}")
                
            # Read and return template content
            return template_file.read_text()
        except Exception as e:
            logger.error(f"Error loading template: {e}")
            raise
    
    @staticmethod
    def create_prompt(company_name, symbol, period, analysis, impact_table, additional_metrics=None):
        """Create the final prompt by formatting the template with the data"""
        template = PromptLoader.load_prompt_template(period)
        
        # Extract the first analysis if it's a list
        if isinstance(analysis, list):
            analysis = analysis[0]
        
        # Create the base prompt parameters
        prompt_params = {
            'company_name': company_name,
            'symbol': symbol,
            'period': period,
            'trend': f"{analysis['strength']} {analysis['movement']}" if analysis['strength'] else analysis['movement'],
            'change_percentage': analysis['percent_change'],
            'high': analysis['day_high'],
            'low': analysis['day_low'],
            'volatility': f"{analysis['range_percent']:.2f}%",
            'volume_trend': 'average',  # Default value since we don't have volume data
            'impact_table': impact_table
        }
        
        # Add additional metrics for long-term analysis if available
        if additional_metrics:
            prompt_params.update({
                'avg_daily_volume': additional_metrics.get('avg_daily_volume', 'N/A'),
                'avg_daily_range': additional_metrics.get('avg_daily_range', 'N/A'),
                'high_volume_days': additional_metrics.get('high_volume_days', 'N/A')
            })
        
        # Create the prompt by replacing placeholders
        try:
            logger.info(f"Formatting prompt with parameters: {prompt_params}")
            prompt = template.format(**prompt_params)
            
            # Log the final prompt with all variables
            logger.info("\n=== FINAL PROMPT WITH VARIABLES ===")
            logger.info("Template File: %s", 'prompts/monthly_prompt.txt' if period == '1mo' else 'prompts/long_term_prompt.txt')
            logger.info("\nVariables:")
            for key, value in prompt_params.items():
                if key == 'impact_table':
                    logger.info("\nImpact Table:")
                    logger.info(value)
                else:
                    logger.info("%s: %s", key, value)
            logger.info("\nFinal Formatted Prompt:")
            logger.info(prompt)
            logger.info("=== END OF PROMPT ===\n")
            
            return prompt
        except KeyError as e:
            logger.error(f"Missing key in prompt parameters: {e}")
            raise
        except Exception as e:
            logger.error(f"Error formatting prompt: {e}")
            raise

# Export the PromptLoader.create_prompt method as the module-level function
create_prompt = PromptLoader.create_prompt
