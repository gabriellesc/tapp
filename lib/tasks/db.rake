namespace :db do
  namespace :seed do
    task :chass do
      importer = ChassImporter.new("seeds/mock_chass")
      puts "Mock CHASS data import successful!"
    end
  end
end
